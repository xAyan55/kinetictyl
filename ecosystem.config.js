module.exports = {
  apps: [
    {
      name: 'kinetictyl-panel',
      script: './airlink-panel/dist/index.js',
      cwd: './airlink-panel',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'kinetictyl-agent',
      script: './airlink-daemon/dist/server.js',
      cwd: './airlink-daemon',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
