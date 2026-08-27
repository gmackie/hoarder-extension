from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class StorageRootSettings(BaseModel):
    key: str
    label: str
    path: str
    sentinel: str | None = None
    exclude_patterns: list[str] = Field(default_factory=list)
    thumbnail_patterns: list[str] = Field(default_factory=list)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HOARDER_", env_file=".env")

    database_url: str = "sqlite:///./data/catalog.db"
    storage_roots: list[StorageRootSettings] = Field(default_factory=list)
    web_dist: str | None = None
