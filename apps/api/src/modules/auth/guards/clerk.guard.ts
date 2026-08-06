import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';

@Injectable()
export class ClerkGuard implements CanActivate {
  private readonly secretKey: string;

  constructor(private readonly config: ConfigService) {
    this.secretKey = this.config.getOrThrow<string>('CLERK_SECRET_KEY');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = this.extractToken(request);

    if (!token) throw new UnauthorizedException('Missing authentication token');

    try {
      const payload = await verifyToken(token, { secretKey: this.secretKey });
      request.user = { clerkId: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  private extractToken(request: Request): string | undefined {
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return undefined;
  }
}
