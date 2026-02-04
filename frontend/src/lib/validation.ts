/**
 * Shared validation utilities for signup flow
 * ファイル: /lib/validation.ts
 */

// ─────────────────────────────────────────────
// Email validation
// ─────────────────────────────────────────────
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | undefined {
  if (!email) return undefined; // optional field
  const trimmed = email.trim();
  if (!EMAIL_REGEX.test(trimmed)) {
    return "Please enter a valid email address";
  }
  return undefined;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

// ─────────────────────────────────────────────
// Phone validation
// ─────────────────────────────────────────────
const PHONE_REGEX = /^[\d\s\-+()]{7,20}$/;

export function validatePhone(phone: string): string | undefined {
  if (!phone) return undefined; // optional field
  const trimmed = phone.trim();
  if (!PHONE_REGEX.test(trimmed)) {
    return "Please enter a valid phone number";
  }
  return undefined;
}

export function isValidPhone(phone: string): boolean {
  return PHONE_REGEX.test(phone.trim());
}

/**
 * Convert phone number to E.164 format
 * @param raw - Raw phone input
 * @returns E.164 formatted number or null if invalid
 */
export function toE164(raw: string): string | null {
  const s = (raw || "").trim();

  // Already in E.164 format
  if (s.startsWith("+")) {
    return /^\+\d{7,15}$/.test(s) ? s : null;
  }

  const digits = s.replace(/\D/g, "");

  // US/CA 10 digit format
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // US/CA 11 digit format with leading 1
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // International format (7-15 digits)
  if (digits.length >= 7 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

// ─────────────────────────────────────────────
// Name validation
// ─────────────────────────────────────────────
export function validateFullName(name: string): string | undefined {
  const trimmed = (name || "").trim();

  if (!trimmed) {
    return "Full name is required";
  }

  if (trimmed.length < 2) {
    return "Name must be at least 2 characters";
  }

  if (trimmed.length > 100) {
    return "Name must be less than 100 characters";
  }

  // Check for at least one letter
  if (!/[a-zA-Z\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(trimmed)) {
    return "Name must contain at least one letter";
  }

  return undefined;
}

export function isValidFullName(name: string): boolean {
  return validateFullName(name) === undefined;
}

// ─────────────────────────────────────────────
// Password validation
// ─────────────────────────────────────────────
export interface PasswordStrength {
  score: number; // 0-4
  feedback: string[];
  isStrong: boolean;
}

export function validatePassword(password: string): string | undefined {
  if (!password) {
    return "Password is required";
  }

  if (password.length < 8) {
    return "Password must be at least 8 characters";
  }

  if (password.length > 128) {
    return "Password must be less than 128 characters";
  }

  return undefined;
}

export function getPasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  let score = 0;

  if (!password) {
    return { score: 0, feedback: ["Enter a password"], isStrong: false };
  }

  // Length checks
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;

  // Character diversity checks
  if (/[a-z]/.test(password)) {
    score += 0.5;
  } else {
    feedback.push("Add lowercase letters");
  }

  if (/[A-Z]/.test(password)) {
    score += 0.5;
  } else {
    feedback.push("Add uppercase letters");
  }

  if (/\d/.test(password)) {
    score += 0.5;
  } else {
    feedback.push("Add numbers");
  }

  if (/[^a-zA-Z0-9]/.test(password)) {
    score += 0.5;
  } else {
    feedback.push("Add special characters");
  }

  // Common patterns to avoid
  const commonPatterns = [
    /^123/,
    /password/i,
    /qwerty/i,
    /abc123/i,
    /^[a-zA-Z]+$/,
    /^[0-9]+$/,
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      score = Math.max(0, score - 1);
      feedback.push("Avoid common patterns");
      break;
    }
  }

  return {
    score: Math.min(4, Math.floor(score)),
    feedback: feedback.slice(0, 3),
    isStrong: score >= 3,
  };
}

// ─────────────────────────────────────────────
// OTP / Verification code validation
// ─────────────────────────────────────────────
export function validateOtp(code: string, length = 6): string | undefined {
  const digits = (code || "").replace(/\D/g, "");

  if (!digits) {
    return `Please enter the ${length}-digit code`;
  }

  if (digits.length !== length) {
    return `Code must be ${length} digits`;
  }

  return undefined;
}

export function isValidOtp(code: string, length = 6): boolean {
  const digits = (code || "").replace(/\D/g, "");
  return digits.length === length;
}

export function formatOtp(code: string): string {
  return (code || "").replace(/\D/g, "").slice(0, 6);
}

// ─────────────────────────────────────────────
// Generic form validation helper
// ─────────────────────────────────────────────
export type ValidationRule<T> = (value: T) => string | undefined;

export function createValidator<T extends Record<string, unknown>>(
  rules: Partial<Record<keyof T, ValidationRule<unknown>>>
) {
  return (data: T): Partial<Record<keyof T, string>> => {
    const errors: Partial<Record<keyof T, string>> = {};

    for (const [field, rule] of Object.entries(rules)) {
      if (rule) {
        const error = rule(data[field as keyof T]);
        if (error) {
          errors[field as keyof T] = error;
        }
      }
    }

    return errors;
  };
}

// ─────────────────────────────────────────────
// Network check utility
// ─────────────────────────────────────────────
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export function checkNetworkAndThrow(): void {
  if (!isOnline()) {
    throw new Error("No internet connection. Please check your network and try again.");
  }
}