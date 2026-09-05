require('dotenv').config();
const nodemailer = require('nodemailer');

// Create transporter for Gmail SMTP
const createTransporter = () => {
  // Check if email credentials are configured
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log('Email credentials not configured');
    return null;
  }

  console.log('Creating SMTP transporter with user:', process.env.GMAIL_USER);

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // uses STARTTLS
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
};

// Send email with fallback to console logging
const sendEmail = async (options) => {
  const { to, subject, html, text } = options;
  
  const transporter = createTransporter();
  
  if (!transporter) {
    // Fallback: log to console
    console.log('=== EMAIL WOULD BE SENT ===');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('HTML:', html);
    console.log('Text:', text);
    console.log('=========================');
    return { success: false, method: 'console' };
  }

  try {
    const mailOptions = {
      from: `"WorkHR" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
      text
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[email] SMTP accepted: ${JSON.stringify(info.accepted)} rejected: ${JSON.stringify(info.rejected)} response: ${info.response} messageId: ${info.messageId}`);
    return { success: true, method: 'smtp', messageId: info.messageId };
  } catch (error) {
    console.error('Email send error:', error);
    // Fallback to console logging on error
    console.log('=== EMAIL WOULD BE SENT (SMTP FAILED) ===');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('HTML:', html);
    console.log('Text:', text);
    console.log('========================================');
    return { success: false, method: 'console', error: error.message };
  }
};

module.exports = { sendEmail };