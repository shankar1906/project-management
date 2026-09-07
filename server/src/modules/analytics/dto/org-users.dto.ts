/**
 * DTOs for org-level user/member list (dashboard and user management).
 */

/** Single user/member row for current org */
export interface OrgUserListItemDto {
    /** User id (null when INVITED and not yet accepted) */
    userId: string | null;
    /** Display name */
    name: string | null;
    /** Email (from User or invite email) */
    email: string | null;
    /** Org role: OWNER | ADMIN | MEMBER */
    role: string;
    /** Membership status: ACTIVE | INVITED | REJECTED */
    status: string;
    /** When the user joined or was invited */
    joinedAt: string;
    /** Total tasks assigned to this user in the org (0 for invited/rejected) */
    tasksAssignedCount: number;
    /** Assigned tasks considered completed (status name matches done/complete) */
    tasksCompleted: number;
    /** Assigned tasks still pending (tasksAssignedCount - tasksCompleted) */
    tasksPending: number;
}

export interface OrgUsersResponseDto {
    users: OrgUserListItemDto[];
    total: number;
}
