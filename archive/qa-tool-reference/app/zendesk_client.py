import base64
import httpx
from app.config import settings


class ZendeskAuthError(Exception):
    """Raised when Zendesk rejects our credentials."""


class ZendeskClient:
    @staticmethod
    def is_configured() -> bool:
        """Return True only when all three Zendesk credentials are present."""
        return bool(
            settings.zendesk_subdomain
            and settings.zendesk_email
            and settings.zendesk_api_token
        )

    def __init__(self):
        # Zendesk credentials are optional — only required when using Zendesk mode.
        # Raise a clear error here so the UI can surface it immediately.
        if not self.is_configured():
            missing = []
            if not settings.zendesk_subdomain:
                missing.append("ZENDESK_SUBDOMAIN")
            if not settings.zendesk_email:
                missing.append("ZENDESK_EMAIL")
            if not settings.zendesk_api_token:
                missing.append("ZENDESK_API_TOKEN")
            raise ZendeskAuthError(
                f"Zendesk is not configured ({', '.join(missing)} missing in .env). "
                f"Either add those values and restart, or use the "
                f"'Paste Conversation' tab instead — it works without Zendesk."
            )

        self.base_url = f"https://{settings.zendesk_subdomain}.zendesk.com/api/v2"
        token = base64.b64encode(
            f"{settings.zendesk_email}/token:{settings.zendesk_api_token}".encode()
        ).decode()
        self.headers = {
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json",
        }

    def _handle_response_error(self, resp: httpx.Response, context: str = "request"):
        """Translate HTTP error codes into user-friendly messages."""
        if resp.status_code == 401:
            raise ZendeskAuthError(
                "Zendesk returned 401 Unauthorized. "
                "Check that ZENDESK_EMAIL and ZENDESK_API_TOKEN in your .env are correct. "
                "The token must be an API token (not your password) — generate one at "
                f"https://{settings.zendesk_subdomain}.zendesk.com/admin/apps-integrations/apis/zendesk-api."
            )
        if resp.status_code == 403:
            raise ZendeskAuthError(
                "Zendesk returned 403 Forbidden. "
                "Your API token is valid but lacks permission for this resource. "
                "Ensure the agent account has the required role in Zendesk Admin."
            )
        if resp.status_code == 404:
            raise ValueError(
                f"Ticket not found (404). Verify the ticket ID exists in your Zendesk account "
                f"({settings.zendesk_subdomain}.zendesk.com)."
            )
        resp.raise_for_status()

    async def get_ticket(self, ticket_id: str) -> dict:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{self.base_url}/tickets/{ticket_id}.json",
                    headers=self.headers,
                    timeout=30,
                )
                self._handle_response_error(resp, f"ticket {ticket_id}")
                return resp.json()["ticket"]
        except (ZendeskAuthError, ValueError):
            raise
        except httpx.ConnectError as e:
            raise ZendeskAuthError(
                f"Could not reach Zendesk at '{settings.zendesk_subdomain}.zendesk.com'. "
                f"Check that ZENDESK_SUBDOMAIN is correct in your .env file. (Detail: {e})"
            )
        except httpx.TimeoutException:
            raise RuntimeError("Zendesk request timed out. Try again in a moment.")

    async def get_ticket_comments(self, ticket_id: str) -> list[dict]:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{self.base_url}/tickets/{ticket_id}/comments.json",
                    headers=self.headers,
                    timeout=30,
                )
                self._handle_response_error(resp, f"comments for ticket {ticket_id}")
                return resp.json()["comments"]
        except (ZendeskAuthError, ValueError):
            raise
        except httpx.ConnectError as e:
            raise ZendeskAuthError(
                f"Could not reach Zendesk. Check ZENDESK_SUBDOMAIN in .env. (Detail: {e})"
            )

    async def get_ticket_with_conversation(self, ticket_id: str) -> dict:
        ticket = await self.get_ticket(ticket_id)
        comments = await self.get_ticket_comments(ticket_id)

        conversation = []
        for c in comments:
            role = "customer" if c.get("public") and c.get("author_id") == ticket.get("requester_id") else "agent"
            if not conversation:
                role = "customer"
            conversation.append({
                "role": role,
                "author": c.get("author_id"),
                "body": c.get("plain_body") or c.get("body", ""),
                "created_at": c.get("created_at"),
                "public": c.get("public", True),
            })

        agent_id = ticket.get("assignee_id")
        agent_name = "Unknown"
        agent_email = ""

        if agent_id:
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(
                        f"{self.base_url}/users/{agent_id}.json",
                        headers=self.headers,
                        timeout=15,
                    )
                    if resp.status_code == 200:
                        user = resp.json()["user"]
                        agent_name = user.get("name", "Unknown")
                        agent_email = user.get("email", "")
            except Exception:
                pass  # Agent lookup is best-effort

        return {
            "ticket": ticket,
            "conversation": conversation,
            "agent_name": agent_name,
            "agent_email": agent_email,
        }

    async def search_tickets(self, query: str, per_page: int = 25) -> list[dict]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/search.json",
                headers=self.headers,
                params={"query": query, "per_page": per_page},
                timeout=30,
            )
            self._handle_response_error(resp, "search")
            return resp.json().get("results", [])
