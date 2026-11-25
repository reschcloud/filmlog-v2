export interface ViewContext {
  el: HTMLElement;
  params: string[];
  /** false, sobald der Nutzer die Ansicht verlassen hat */
  alive: () => boolean;
}

export type ViewFn = (ctx: ViewContext) => void | Promise<void>;
