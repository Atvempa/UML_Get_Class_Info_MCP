import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";

// Employee leave records
const employeeLeaves: Record<string, { balance: number; history: string[] }> = {
  E001: { balance: 18, history: ["2024-12-25", "2025-01-01"] },
  E002: { balance: 20, history: [] },
};

const handler = createMcpHandler(
  (server) => {
    // Tool: Get Leave Balance
    server.tool(
      "get_leave_balance",
      "Check how many leave days are left for the employee",
      { employee_id: z.string() },
      async ({ employee_id }) => {
        const data = employeeLeaves[employee_id];
        if (data) {
          return {
            content: [
              {
                type: "text",
                text: `${employee_id} has ${data.balance} leave days remaining.`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: "Employee ID not found." }],
        };
      }
    );

    // Tool: Apply for Leave
    server.tool(
      "apply_leave",
      "Apply leave for specific dates (e.g., ['2025-04-17'])",
      {
        employee_id: z.string(),
        leave_dates: z.array(z.string()),
      },
      async ({ employee_id, leave_dates }) => {
        const data = employeeLeaves[employee_id];
        if (!data) {
          return {
            content: [{ type: "text", text: "Employee ID not found." }],
          };
        }

        const requestedDays = leave_dates.length;
        const available = data.balance;

        if (available < requestedDays) {
          return {
            content: [
              {
                type: "text",
                text: `Insufficient leave balance. You requested ${requestedDays} day(s) but have only ${available}.`,
              },
            ],
          };
        }

        // Deduct balance and record history
        data.balance -= requestedDays;
        data.history.push(...leave_dates);

        return {
          content: [
            {
              type: "text",
              text: `Leave applied for ${requestedDays} day(s). Remaining balance: ${data.balance}.`,
            },
          ],
        };
      }
    );

    // Tool: Get Leave History
    server.tool(
      "get_leave_history",
      "Get leave history for the employee",
      { employee_id: z.string() },
      async ({ employee_id }) => {
        const data = employeeLeaves[employee_id];
        if (!data) {
          return {
            content: [{ type: "text", text: "Employee ID not found." }],
          };
        }

        const history =
          data.history.length > 0
            ? data.history.join(", ")
            : "No leaves taken.";

        return {
          content: [
            {
              type: "text",
              text: `Leave history for ${employee_id}: ${history}`,
            },
          ],
        };
      }
    );
  },
  {
    capabilities: {
      tools: {
        get_leave_balance: {
          description: "Check how many leave days are left for the employee",
        },
        apply_leave: {
          description: "Apply leave for specific dates (e.g., ['2025-04-17'])",
        },
        get_leave_history: {
          description: "Get leave history for the employee",
        },
      },
    },
  },
  {
    redisUrl: process.env.REDIS_URL,
    basePath: "",
    verboseLogs: true,
    maxDuration: 60,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
