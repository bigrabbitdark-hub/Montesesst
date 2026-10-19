// Classes compartilhadas pelos formulários e botões do módulo de EPI (alvos de 44px, texto de 16px, foco visível).
export const LABEL = 'mb-1 block text-base font-medium text-dash-primary';
export const FIELD =
  'min-h-[44px] w-full rounded-lg border border-dash-border-input bg-dash-card px-3 text-base text-dash-primary ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-brand-green-dark';
export const BTN =
  'min-h-[44px] rounded-lg px-4 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-dash-brand-green-dark aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
export const BTN_PRIMARY = `${BTN} bg-dash-brand-green-dark text-white hover:opacity-90`;
export const BTN_SECONDARY = `${BTN} inline-flex items-center justify-center border border-dash-border-input bg-dash-card text-dash-primary hover:bg-dash-page`;
export const BTN_DANGER = `${BTN} bg-red-700 text-white hover:bg-red-800`;
