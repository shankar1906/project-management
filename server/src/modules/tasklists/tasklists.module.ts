import { Module } from '@nestjs/common';
import { TaskListsController } from './tasklists.controller';
import { TaskListsService } from './tasklists.service';

@Module({
    controllers: [TaskListsController],
    providers: [TaskListsService],
    exports: [TaskListsService],
})
export class TaskListsModule { }
