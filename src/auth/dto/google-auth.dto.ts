import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// Schema untuk Google OAuth User Profile
export const GoogleUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string(),
  nim: z.string().optional(),
  major: z.string().optional(),
  batch: z.string().optional(),
  picture: z.string().url().optional(),
  googleId: z.string(),
});

export class GoogleUserDto extends createZodDto(GoogleUserSchema) {}

// Schema untuk Auth Response
export const AuthResponseSchema = z.object({
  access_token: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    fullName: z.string(),
    nim: z.string().nullable(),
    major: z.string().nullable(),
    profilePicture: z.string().nullable(),
    isSeller: z.boolean(),
    isVerified: z.boolean(),
  }),
});

export class AuthResponseDto extends createZodDto(AuthResponseSchema) {}

// Schema untuk JWT Payload
export const JwtPayloadSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type JwtPayload = z.infer<typeof JwtPayloadSchema>;