import { Controller, Get } from '@nestjs/common';
import { Public } from './decorators/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get()
  getHello(): { message: string; status: string } {
    return {
      message: 'Welcome to Guard Nest — NestJS Guard Library',
      status: 'Server is running',
    };
  }

  @Public()
  @Get('health')
  health(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
