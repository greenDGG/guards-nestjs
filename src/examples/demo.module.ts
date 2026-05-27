import { Module } from '@nestjs/common';
import { Level1BasicController } from './level1-basic.controller';
import { Level2SecurityController } from './level2-security.controller';
import { Level3RateLimitController } from './level3-rate-limit.controller';
import { Level4DetectionController } from './level4-detection.controller';
import { Level5BusinessController } from './level5-business.controller';
import { Level6Web3Controller } from './level6-web3.controller';

@Module({
  controllers: [
    Level1BasicController,
    Level2SecurityController,
    Level3RateLimitController,
    Level4DetectionController,
    Level5BusinessController,
    Level6Web3Controller,
  ],
})
export class DemoModule {}
