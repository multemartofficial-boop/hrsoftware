const { app, ready, checkExpiringWorkers } = require('./app');

const PORT = process.env.PORT || 3001;

// Start server (local development / non-serverless hosting)
ready.then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Database config:`);
    console.log(`  Host: ${process.env.DB_HOST}`);
    console.log(`  Database: ${process.env.DB_NAME}`);
    console.log(`  User: ${process.env.DB_USER}`);
    console.log(`  Port: ${process.env.DB_PORT || 3306}`);
  });

  // Run expiry check immediately on startup
  checkExpiringWorkers().then(result => {
    console.log('Initial expiry check completed:', result);
  }).catch(err => {
    console.error('Initial expiry check failed:', err);
  });

  // Schedule expiry check to run every 24 hours
  setInterval(() => {
    checkExpiringWorkers().then(result => {
      console.log('Scheduled expiry check completed:', result);
    }).catch(err => {
      console.error('Scheduled expiry check failed:', err);
    });
  }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
