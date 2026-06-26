from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    zendesk_subdomain: str = ""
    zendesk_email: str = ""
    zendesk_api_token: str = ""
    anthropic_api_key: str = ""
    database_url: str = "sqlite+aiosqlite:///./qa_tool.db"
    secret_key: str = "dev-secret"
    turso_database_url: str = ""
    turso_auth_token: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
