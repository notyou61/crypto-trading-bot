import dotenv from 'dotenv';
dotenv.config();

console.log("Email Address:", process.env.REPORT_EMAIL_ADDRESS);
console.log("App Password:", process.env.REPORT_EMAIL_PASSWORD);
