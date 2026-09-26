/** Start diagnostics even if the initial symbol scan fails. */
export async function startDiagnosticsAfterIndex(
    initializeIndex: () => Promise<void>,
    startDiagnostics: () => void,
    reportIndexFailure: (error: unknown) => void
): Promise<void> {
    try {
        await initializeIndex();
    } catch (error) {
        reportIndexFailure(error);
    } finally {
        startDiagnostics();
    }
}
