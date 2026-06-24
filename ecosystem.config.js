// PM2 process-manager config. PM2 keeps the ERP running and AUTO-RESTARTS it if it ever crashes,
// so a single bad request no longer means "the site is down until someone restarts it manually."
//
//   Start:    npm run pm2:start
//   Status:   npm run pm2:status
//   Logs:     npm run pm2:logs
//   Stop:     npm run pm2:stop
//
// The app loads its own .env (via dotenv in server.js), so PM2 does not need the DB vars in its
// environment — it works the same whether started from a terminal or on boot.
module.exports = {
  apps: [
    {
      name: 'kinaadman-erp',
      script: 'server.js',
      exec_mode: 'fork',          // single process. Switch to 'cluster' + instances:'max' for multi-core later.
      instances: 1,
      autorestart: true,          // ← the whole point: bring the server back up automatically after a crash
      max_restarts: 15,           // give up after 15 rapid crashes so a broken config gets noticed (no infinite loop)
      min_uptime: '15s',          // must stay up 15s to count as a healthy start
      restart_delay: 2000,        // wait 2s between restarts
      max_memory_restart: '600M', // recycle the process if it ever leaks past 600MB
      watch: false,
      time: true,                 // timestamp every log line
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
