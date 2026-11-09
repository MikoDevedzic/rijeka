"""The stack's scripts and a hosted database (Edgar, 9 November 2026): `python -m stack.apply --reset` followed the
environment's DATABASE_URL, and a developer's shell exports the hosted one. A hosted database is accepted only when
it is named on the command line, and never for a reset or the seed. The URL is printed without its password."""
import pytest

from stack import apply

HOSTED = "postgresql://postgres.abc:s3cret@aws-1-us-east-1.pooler.supabase.com:6543/postgres"
DIRECT = "postgresql://postgres:s3cret@db.abcdefgh.supabase.co:5432/postgres"
LOCAL = "postgresql:///rijeka_test"


@pytest.fixture(autouse=True)
def _no_env(monkeypatch):
    monkeypatch.delenv("RIJEKA_STACK_DATABASE_URL", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)


def test_the_default_is_the_local_test_database():
    assert apply.database_url(None) == apply.DEFAULT_URL == LOCAL
    assert apply.database_url(None, destructive=True) == LOCAL


@pytest.mark.parametrize("url", [HOSTED, DIRECT])
def test_a_hosted_database_from_the_environment_is_refused(monkeypatch, url):
    for var in ("DATABASE_URL", "RIJEKA_STACK_DATABASE_URL"):
        monkeypatch.setenv(var, url)
        with pytest.raises(SystemExit) as e:
            apply.database_url(None)
        assert "s3cret" not in str(e.value) and "supabase" not in str(e.value)
        monkeypatch.delenv(var)


@pytest.mark.parametrize("url", [HOSTED, DIRECT])
def test_a_hosted_database_named_on_the_command_line_takes_the_schema_but_never_a_reset_or_the_seed(url):
    assert apply.database_url(url) == url
    with pytest.raises(SystemExit) as e:
        apply.database_url(url, destructive=True)
    assert "s3cret" not in str(e.value)


def test_the_stack_variable_wins_over_the_shells_database_url(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", HOSTED)
    monkeypatch.setenv("RIJEKA_STACK_DATABASE_URL", LOCAL)
    assert apply.database_url(None, destructive=True) == LOCAL


def test_the_url_is_printed_without_its_password():
    assert "s3cret" not in apply.shown(HOSTED) and "s3cret" not in apply.shown(DIRECT)
    assert apply.shown(HOSTED).startswith("postgresql://postgres.abc:***@aws-1")
    assert apply.shown(LOCAL) == LOCAL


@pytest.mark.parametrize("dsn", [
    "host=db.abcdefgh.supabase.co port=5432 user=postgres password=s3cret dbname=postgres",
    "postgresql://db.abcdefgh.supabase.co/postgres?user=postgres&password=s3cret",
    "postgresql://:s3cret@db.abcdefgh.supabase.co/postgres",
    "postgresql://postgres:s3cret@DB.ABCDEFGH.SUPABASE.CO:5432/postgres",
])
def test_other_spellings_of_a_hosted_address_are_recognised_and_never_printed_with_the_password(dsn):
    assert apply.hosted(dsn)
    assert "s3cret" not in apply.shown(dsn)
    with pytest.raises(SystemExit):
        apply.database_url(dsn, destructive=True)


def test_the_seed_always_asks_destructively():
    import inspect
    from stack import seed
    assert "destructive=True" in inspect.getsource(seed.main)
