const test = require('node:test');
const assert = require('node:assert/strict');

const { EmailNotifier } = require('../src/emailNotifier');

test('email notifier sends a Vietnamese overheat email to configured recipient', async () => {
  let sentMessage;
  const transporter = {
    async sendMail(message) {
      sentMessage = message;
      return { messageId: 'test-message' };
    }
  };
  const notifier = new EmailNotifier({
    host: 'smtp.example.com',
    port: 465,
    secure: true,
    user: 'sender@example.com',
    password: 'secret',
    fromName: 'Smart Environment'
  }, { info() {} }, transporter);

  const result = await notifier.sendOverheat({
    type: 'TEMPERATURE_HIGH',
    value: 42,
    threshold: 35,
    timestamp: '2026-07-26T10:00:00.000Z'
  }, 'receiver@example.com');

  assert.equal(result.sent, true);
  assert.equal(sentMessage.to, 'receiver@example.com');
  assert.match(sentMessage.subject, /42\.0 °C/);
  assert.match(sentMessage.text, /35\.0 °C/);
});

test('email notifier ignores non-temperature notifications', async () => {
  let called = false;
  const notifier = new EmailNotifier({
    host: 'smtp.example.com', port: 465, user: 'sender@example.com', password: 'secret'
  }, { info() {} }, { async sendMail() { called = true; } });

  const result = await notifier.sendOverheat(
    { type: 'LOW_LIGHT' },
    'receiver@example.com'
  );

  assert.equal(result.sent, false);
  assert.equal(called, false);
});
