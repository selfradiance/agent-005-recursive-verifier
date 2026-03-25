# TaskQueue API Specification (Draft)

A simple task queue system. Tasks are created, assigned, and completed.

---

## Roles

### Manager
- Can create tasks and assign them

### Worker
- Can complete tasks assigned to them

---

## Endpoints

### POST /v1/tasks
Create a task.
- **Required fields:** `title` (string), `priority` (string)
- Returns a task object

### POST /v1/tasks/:id/assign
Assign a task to a worker.
- **Required fields:** `workerId` (string)

### POST /v1/tasks/:id/complete
Mark a task as complete.

### GET /v1/tasks
List tasks.

---

## Business Rules

- **R1:** A task can only be completed if it has been assigned
- **R2:** High-priority tasks should be handled before low-priority tasks

---

## Notes

This spec is intentionally vague. Many questions are left open:
- Who can create tasks? Only managers, or workers too?
- Can a completed task be reassigned?
- What happens if you assign a task that's already assigned to someone else?
- What are the valid priority values?
- Can a manager complete a task, or only workers?
- What does "should be handled before" mean — is it enforced or advisory?
- Is there a limit on how many tasks can be assigned to one worker?
- What status transitions are valid? (created → assigned → completed? Can it go back?)
