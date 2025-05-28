// testEmail.js
import nodemailer from 'nodemailer';

async function testEmail() {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'steve.skye.skyelighting@gmail.com',
      pass: 'zjsshnmlvrdbwxsl',
    },
  });
  await transporter.sendMail({
    from: 'steve.skye.skyelighting@gmail.com',
    to: 'steve.skye@skyelighting.com',
    subject: 'Test Email',
    text: 'Test',
  });
  console.log('Email test passed');
}
testEmail().catch(console.error);