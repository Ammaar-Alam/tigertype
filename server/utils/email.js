const nodemailer = require('nodemailer');

let cachedTransporter = null;

const getTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.FEEDBACK_SMTP_HOST;
  const port = process.env.FEEDBACK_SMTP_PORT ? Number(process.env.FEEDBACK_SMTP_PORT) : undefined;
  const user = process.env.FEEDBACK_SMTP_USER;
  const pass = process.env.FEEDBACK_SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Feedback email transport is not configured.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  cachedTransporter = transporter;
  return transporter;
};

const sendFeedbackNotification = async ({
  category,
  message,
  contactInfo,
  netid,
  userAgent,
  pagePath,
  createdAt,
  to,
  from
}) => {
  const transporter = getTransporter();

  const subject = `[TigerType Feedback] ${category.toUpperCase()} from ${netid || 'anonymous user'}`;

  const lines = [
    `Category: ${category}`,
    `Submitted: ${createdAt.toISOString()}`,
    `NetID: ${netid || 'anonymous'}`,
    `Contact: ${contactInfo || 'not provided'}`,
    `Page: ${pagePath || 'unknown'}`,
    '',
    'Message:',
    message,
    '',
    '---',
    `User Agent: ${userAgent || 'unknown'}`
  ];

  const mailOptions = {
    from,
    to,
    subject,
    text: lines.join('\n')
  };

  await transporter.sendMail(mailOptions);
};

module.exports = {
  sendFeedbackNotification
};
