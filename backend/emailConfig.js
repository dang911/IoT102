// SMTP account used by the backend to send overheat alerts.
// With Gmail, use a 16-character App Password, not the normal account password.
// You may edit the fallback values here or set the matching environment variables.
module.exports = Object.freeze({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE === undefined
    ? true
    : ['true', '1', 'yes', 'on'].includes(process.env.SMTP_SECURE.toLowerCase()),
  user: process.env.SMTP_USER || 'loichoi43@gmail.com',
  password: process.env.SMTP_PASSWORD || 'swpqquizmzykfxdt',
  fromName: process.env.SMTP_FROM_NAME || 'Smart Environment Alert'
});
