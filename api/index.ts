import { app, errorHandler } from '../server/app.js';

// Export the existing API without starting the local HTTP server or worker.
app.use(errorHandler);

export default app;
