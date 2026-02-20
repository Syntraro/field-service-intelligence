import { getResendClient } from './resendClient';

export async function sendInvitationEmail(
  recipientEmail: string,
  inviteLink: string,
  companyName: string,
  role: string
) {
  try {
    const { client, fromEmail } = await getResendClient();
    
    const { data, error } = await client.emails.send({
      from: fromEmail,
      to: recipientEmail,
      subject: `You've been invited to join ${companyName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>You've been invited!</h2>
          <p>You've been invited to join <strong>${companyName}</strong> as a <strong>${role}</strong>.</p>
          
          <p>Click the button below to create your account and get started:</p>
          
          <div style="margin: 30px 0;">
            <a href="${inviteLink}" 
               style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Accept Invitation
            </a>
          </div>
          
          <p style="color: #666; font-size: 14px;">
            This invitation link will expire in 7 days.
          </p>
          
          <p style="color: #666; font-size: 14px;">
            If you didn't expect this invitation, you can safely ignore this email.
          </p>
        </div>
      `,
    });

    if (error) {
      throw new Error(error.message || 'Failed to send email');
    }

    return { success: true, emailId: data?.id };
  } catch (error: any) {
    // Re-throw for caller to handle
    throw error;
  }
}
