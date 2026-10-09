#!/usr/bin/env python3
"""Shortcut for the project-root launch.py, which holds the real logic.

    python scripts/launch.py [same arguments as launch.py]

This used to be a separate, older copy that fell behind (it kept an existing .env without
adding new required values such as REDIS_PASSWORD, so `docker compose up` failed).
"""
import os
import runpy
import sys

MAIN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "launch.py")
sys.argv[0] = MAIN
runpy.run_path(MAIN, run_name="__main__")
