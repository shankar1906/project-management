import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Body,
    UseGuards,
    Logger,
} from '@nestjs/common';
import { PhasesService } from './phases.service';
import { CreatePhaseDto } from './dto/create-phase.dto';
import { UpdatePhaseDto, ReorderPhaseDto } from './dto/update-phase.dto';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { OrgId, UserId } from '../../common/decorators/org.decorator';

/**
 * Phases Controller
 * - CRUD operations for phases
 * - Reorder support for drag & drop
 *
 * Guard Pipeline: JwtAuthGuard → OrgGuard
 */
@Controller('phases')
@UseGuards(JwtAuthGuard, OrgGuard)
export class PhasesController {
    private readonly logger = new Logger(PhasesController.name);

    constructor(private readonly phasesService: PhasesService) { }

    /**
     * POST /phases
     * - Create a new phase inside a project
     */
    @Post()
    async create(
        @UserId() userId: string,
        @Body() dto: CreatePhaseDto,
    ) {
        this.logger.log(`Creating phase in project ${dto.projectId}`);
        return this.phasesService.create(userId, dto);
    }

    /**
     * GET /phases/by-project/:projectId
     * - Get all phases under a project
     */
    @Get('by-project/:projectId')
    async findByProject(
        @UserId() userId: string,
        @Param('projectId') projectId: string,
    ) {
        return this.phasesService.findByProject(userId, projectId);
    }


    
    /**
     * PATCH /phases/:phaseId
     * - Update a phase
     */
    @Patch(':phaseId')
    async update(
        @UserId() userId: string,
        @Param('phaseId') phaseId: string,
        @Body() dto: UpdatePhaseDto,
    ) {
        this.logger.log(`Updating phase ${phaseId}`);
        return this.phasesService.update(userId, phaseId, dto);
    }
    /**
     * PATCH /phases/reorder
     * - Reorder phases via drag & drop (must be before :phaseId so "reorder" is not captured as phaseId)
     */
    @Patch('reorder')
    async reorder(
        @UserId() userId: string,
        @Body() dto: ReorderPhaseDto,
    ) {
        this.logger.log(`Reordering phases`);
        return this.phasesService.reorder(userId, dto.orderedIds);
    }


    /**
     * DELETE /phases/:phaseId
     * - Soft delete a phase
     */
    @Delete(':phaseId')
    async remove(
        @UserId() userId: string,
        @Param('phaseId') phaseId: string,
    ) {
        this.logger.log(`Deleting phase ${phaseId}`);
        return this.phasesService.remove(userId, phaseId);
    }
}
