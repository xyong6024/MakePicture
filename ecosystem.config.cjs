module.exports = {
  apps: [
    {
      name: "makepicture",
      script: "src/server.mjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: "3000"
      }
    }
  ]
};
