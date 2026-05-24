export interface EventContourState {
  editing?: boolean;
  preview?: boolean;
  grabbing?: boolean;
}

export function shouldShowEventContour(state: EventContourState): boolean {
  return state.editing === true || state.preview === true || state.grabbing === true;
}
