'use server';

const registrations: Record<string, any> = {};

export async function registerUser(
  phone: string,
  email: string | null,
  alternatePhone: string | null
) {
  // Validate phone
  if (!phone || !/^\d{10}$/.test(phone)) {
    return {
      success: false,
      error: 'Please enter a valid 10-digit phone number',
    };
  }

  try {
    // Store registration (in production, this would go to a database)
    registrations[phone] = {
      phone,
      email: email || null,
      alternatePhone: alternatePhone || null,
      registeredAt: new Date().toISOString(),
    };

    console.log(`User registered: ${phone}`);

    return {
      success: true,
      message: `✓ Registration successful! OTP sent to ${phone}`,
      phone,
    };
  } catch (error) {
    console.error('Registration error:', error);
    return {
      success: false,
      error: 'Error during registration. Please try again.',
    };
  }
}
