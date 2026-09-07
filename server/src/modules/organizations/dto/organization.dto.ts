import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class CreateOrgDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  name: string;
}
