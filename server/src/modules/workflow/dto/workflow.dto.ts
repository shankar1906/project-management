import { IsNotEmpty, IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateStageDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  color?: string;
}

export class CreateStatusDto {
  @IsNotEmpty()
  @IsString()
  stageId: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
