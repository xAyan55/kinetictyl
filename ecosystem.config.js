module.exports = {
  apps: [
    {
      name: "kinetictyl-panel",
      script: "./apps/panel/dist/index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
        DATABASE_URL: "file:./kinetictyl.db",
        APP_SECRET: "z9K7vR2w4xY8pQ1nJ3mB5vT6cE9rW0qY"
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/panel-error.log",
      out_file: "./logs/panel-out.log"
    },
    {
      name: "kinetictyl-agent",
      script: "./apps/agent/dist/index.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "200M",
      env: {
        NODE_ENV: "production",
        AGENT_PORT: 8081,
        SFTP_PORT: 2022,
        SERVER_ROOT_DIR: "./data/servers",
        RUNTIME_DIR: "./data/runtimes"
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./logs/agent-error.log",
      out_file: "./logs/agent-out.log"
    }
  ]
};
