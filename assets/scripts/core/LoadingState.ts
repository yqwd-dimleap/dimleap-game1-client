/** Progress is a stage fraction, rather than a byte or remaining-time estimate. */
export interface LoadingState { progress: number; message: string }
