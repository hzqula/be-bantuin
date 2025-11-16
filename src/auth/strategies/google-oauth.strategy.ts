// src/auth/strategies/google.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { getBatch, getNIM } from 'src/utils/getValue';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private configService: ConfigService) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID')!,
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET')!,
      callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, name, emails, photos } = profile;

    const nim = getNIM(emails[0].value);
    const batch = getBatch(emails[0].value);

    const user = {
      googleId: id,
      email: emails[0].value,
      fullName: name.givenName,
      nim: nim,
      batch: batch,
      major: name.familyName,
      profilePicture: photos[0]?.value,
      provider: 'google',
    };

    done(null, user);
  }
}