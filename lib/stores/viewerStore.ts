import { create } from "zustand";

export interface Highlight {
  startLine: number;
  endLine: number;
  /** Short note shown in the gutter / focus banner. */
  note?: string;
}

export interface AIFocus {
  /** Tool the agent just invoked. */
  tool: "openFile" | "searchCode" | "whoCalls" | "moduleOverview" | "manual";
  path?: string;
  /** One-line summary shown in the banner — usually the agent's input. */
  note?: string;
  /** Wall-clock ms — used to dismiss after N seconds. */
  ts: number;
}

// ─── Tour mode (Prompt 10) ──────────────────────────────────────────────────

export type TourAction =
  | { type: "focus"; path: string; startLine?: number; endLine?: number }
  | { type: "compare"; leftPath: string; rightPath: string }
  | { type: "narrate" };

export interface TourStep {
  title: string;
  narration: string;
  action: TourAction;
}

export interface TourPlan {
  title: string;
  intro: string;
  steps: TourStep[];
  /** Model that produced this plan, for the UI footer. */
  generatedBy: string;
}

export interface ViewerState {
  activeFilePath: string | null;
  highlights: Highlight[];
  /** When set, viewer shows a stacked second pane with `comparePath`. */
  comparePath: string | null;
  aiFocus: AIFocus | null;
  pendingPrompt: string | null;
  chatOpen: boolean;

  /** Tour state. `tour` set ⇒ tour mode on. */
  tour: TourPlan | null;
  /** Index into tour.steps for the currently-shown step. */
  tourStepIndex: number;
  /** True if a chat exchange interrupted the tour. */
  tourPaused: boolean;
}

export interface ViewerActions {
  setActiveFile: (path: string | null, highlights?: Highlight[]) => void;
  setHighlights: (h: Highlight[]) => void;
  setComparePath: (path: string | null) => void;
  setAIFocus: (focus: AIFocus | null) => void;
  askCompass: (prompt: string) => void;
  consumePendingPrompt: () => string | null;
  setChatOpen: (open: boolean) => void;

  /** Start a fresh tour, jumps to step 0 and applies its action. */
  startTour: (plan: TourPlan) => void;
  /** Advance to the next step, applying its action. No-op at end. */
  nextStep: () => void;
  /** Go back one step. */
  prevStep: () => void;
  /** Jump to a specific step index. */
  goToStep: (idx: number) => void;
  /** Pause without ending — user can resume later. Auto-called by Chat. */
  pauseTour: () => void;
  /** Resume after pause. Re-applies current step's action. */
  resumeTour: () => void;
  /** Tear down the tour entirely. */
  endTour: () => void;
}

export type ViewerStore = ViewerState & ViewerActions;

const INITIAL: ViewerState = {
  activeFilePath: null,
  highlights: [],
  comparePath: null,
  aiFocus: null,
  pendingPrompt: null,
  chatOpen: true,
  tour: null,
  tourStepIndex: 0,
  tourPaused: false,
};

export const useViewerStore = create<ViewerStore>((set, get) => ({
  ...INITIAL,

  setActiveFile: (path, highlights = []) =>
    set({ activeFilePath: path, highlights, comparePath: null }),

  setHighlights: (h) => set({ highlights: h }),

  setComparePath: (path) => set({ comparePath: path }),

  setAIFocus: (focus) => set({ aiFocus: focus }),

  askCompass: (prompt) =>
    set({ pendingPrompt: prompt, chatOpen: true }),

  consumePendingPrompt: () => {
    const p = get().pendingPrompt;
    if (p !== null) set({ pendingPrompt: null });
    return p;
  },

  setChatOpen: (open) => set({ chatOpen: open }),

  startTour: (plan) => {
    set({
      tour: plan,
      tourStepIndex: 0,
      tourPaused: false,
      chatOpen: true,
    });
    applyStep(plan.steps[0], set);
  },

  nextStep: () => {
    const { tour, tourStepIndex } = get();
    if (!tour) return;
    const next = Math.min(tour.steps.length - 1, tourStepIndex + 1);
    if (next === tourStepIndex) return;
    set({ tourStepIndex: next, tourPaused: false });
    applyStep(tour.steps[next], set);
  },

  prevStep: () => {
    const { tour, tourStepIndex } = get();
    if (!tour) return;
    const prev = Math.max(0, tourStepIndex - 1);
    if (prev === tourStepIndex) return;
    set({ tourStepIndex: prev, tourPaused: false });
    applyStep(tour.steps[prev], set);
  },

  goToStep: (idx) => {
    const { tour } = get();
    if (!tour) return;
    const clamped = Math.max(0, Math.min(tour.steps.length - 1, idx));
    set({ tourStepIndex: clamped, tourPaused: false });
    applyStep(tour.steps[clamped], set);
  },

  pauseTour: () => {
    const { tour } = get();
    if (!tour) return;
    set({ tourPaused: true });
  },

  resumeTour: () => {
    const { tour, tourStepIndex } = get();
    if (!tour) return;
    set({ tourPaused: false });
    applyStep(tour.steps[tourStepIndex], set);
  },

  endTour: () =>
    set({ tour: null, tourStepIndex: 0, tourPaused: false }),
}));

/**
 * Project a tour step's action onto the viewer state. Centralized so
 * start/next/prev/resume all behave identically — no drift.
 */
function applyStep(
  step: TourStep | undefined,
  set: (partial: Partial<ViewerState>) => void,
): void {
  if (!step) return;
  const { action } = step;
  switch (action.type) {
    case "focus": {
      const highlights: Highlight[] =
        action.startLine && action.endLine
          ? [{ startLine: action.startLine, endLine: action.endLine }]
          : [];
      set({
        activeFilePath: action.path,
        highlights,
        comparePath: null,
        aiFocus: {
          tool: "openFile",
          path: action.path,
          note: step.title,
          ts: Date.now(),
        },
      });
      return;
    }
    case "compare": {
      set({
        activeFilePath: action.leftPath,
        comparePath: action.rightPath,
        highlights: [],
        aiFocus: {
          tool: "openFile",
          path: action.leftPath,
          note: `vs. ${action.rightPath}`,
          ts: Date.now(),
        },
      });
      return;
    }
    case "narrate": {
      set({
        aiFocus: {
          tool: "manual",
          note: step.title,
          ts: Date.now(),
        },
      });
      return;
    }
  }
}
