// sendEmail.js

import 'dotenv/config';
import nodemailer from 'nodemailer';

// Create transport with Gmail SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true', // false = STARTTLS
  auth: {
    user: process.env.BOT_EMAIL_ADDRESS,
    pass: process.env.BOT_EMAIL_PASSWORD,
  },
});

// Email message details
const mailOptions = {
  from: `"Solana Bot" <${process.env.BOT_EMAIL_ADDRESS}>`,
  to: 'steve.skye@skyelighting.com', // Your main inbox
  subject: '✅ Solana Bot Test Email',
  text: 'This is a test email from your Solana Bot SMTP configuration. Everything is working correctly.',
  html: '<p>This is a <strong>test email</strong> from your Solana Bot SMTP configuration. Everything is working correctly.</p>',
};

// Send the email
transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('❌ Email failed to send:', error.message);
  } else {
    console.log(`✅ Email sent: ${info.response}`);
  }
});
