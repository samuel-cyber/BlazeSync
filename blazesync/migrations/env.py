"""Alembic environment — pulls the URL from app settings and exposes
metadata from app.models so autogenerate can diff the schema.
"""

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context

# Make the app package importable when Alembic runs from any cwd.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import engine as app_engine
from app.models import SQLModel

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run against the app's own engine.

    Reusing the app engine keeps dev/tests/prod on one code path — in the
    test suite the engine's search_path is already pointed at an isolated
    schema, so migrations land in the right place automatically.
    """
    with app_engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
