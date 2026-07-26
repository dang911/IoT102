const nodemailer = require('nodemailer');

class EmailNotifier {
  constructor(config = {}, logger = console, transporter = null) {
    this.config = config;
    this.logger = logger;
    this.transporter = transporter;
  }

  get enabled() {
    return Boolean(
      this.config.host &&
      this.config.port &&
      this.config.user &&
      this.config.password
    );
  }

  transport() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: Boolean(this.config.secure),
        auth: {
          user: this.config.user,
          pass: this.config.password
        }
      });
    }
    return this.transporter;
  }

  async sendOverheat(notification, recipient) {
    if (!this.enabled || !recipient || notification.type !== 'TEMPERATURE_HIGH') {
      return { sent: false };
    }

    const value = Number(notification.value);
    const threshold = Number(notification.threshold);
    const temperatureText = Number.isFinite(value) ? `${value.toFixed(1)} °C` : 'không xác định';
    const thresholdText = Number.isFinite(threshold) ? `${threshold.toFixed(1)} °C` : 'ngưỡng cấu hình';
    const timestamp = new Date(notification.timestamp).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh'
    });

    const info = await this.transport().sendMail({
      from: `"${this.config.fromName}" <${this.config.user}>`,
      to: recipient,
      subject: `[CẢNH BÁO] Nhiệt độ quá cao: ${temperatureText}`,
      text: [
        'Hệ thống Smart Environment phát hiện nhiệt độ quá cao.',
        `Nhiệt độ hiện tại: ${temperatureText}`,
        `Ngưỡng cảnh báo: ${thresholdText}`,
        `Thời gian: ${timestamp}`,
        'Vui lòng kiểm tra thiết bị và khu vực giám sát ngay.'
      ].join('\n')
    });

    this.logger.info(`Đã gửi email cảnh báo quá nhiệt tới ${recipient}: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  }
}

module.exports = { EmailNotifier };
