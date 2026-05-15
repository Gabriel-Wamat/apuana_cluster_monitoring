#!/usr/bin/env python3
"""
Streamlit dashboard for SLURM monitoring, configurable through SLURM_MONITOR_*.

Shared logic lives in slurm_core.py and is testable with `python slurm_core.py`.
"""

from __future__ import annotations

import io
import os
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import streamlit as st

import slurm_core as sc


def show_slurm_error_friendly(title: str, stderr: str, stdout: str) -> None:
    st.error(f"{title}: {sc.human_slurm_failure(stderr, stdout)}")
    with st.expander("Technical details (stderr/stdout)"):
        st.code((stderr or "(empty stderr)") + "\n---\n" + (stdout or ""), language="text")


@st.cache_data(ttl=5, show_spinner=False)
def slurm_squeue_user(user: str) -> tuple[int, str, str]:
    return sc.run_squeue_user(user)


@st.cache_data(ttl=8, show_spinner=False)
def slurm_squeue_global(max_lines: int) -> tuple[int, str, str]:
    return sc.run_squeue_global(max_lines)


@st.cache_data(ttl=12, show_spinner=False)
def slurm_squeue_users_raw() -> tuple[int, str, str]:
    return sc.run_squeue_users_raw()


@st.cache_data(ttl=25, show_spinner=False)
def slurm_sinfo() -> tuple[int, str, str]:
    return sc.run_sinfo()


@st.cache_data(ttl=45, show_spinner=False)
def slurm_sacct_user(user: str, hours: int, max_lines: int) -> tuple[int, str, str]:
    return sc.run_sacct_user(user, hours, max_lines)


@st.cache_data(ttl=45, show_spinner=False)
def slurm_sacct_job(job_id: str, max_lines: int) -> tuple[int, str, str]:
    return sc.run_sacct_job(job_id, max_lines)


@st.cache_data(ttl=20, show_spinner=False)
def slurm_scontrol(job_id: str) -> tuple[int, str, str]:
    return sc.run_scontrol(job_id)


@st.cache_data(ttl=60, show_spinner=False)
def slurm_sacct_ping(user: str) -> tuple[int, str, str]:
    return sc.run_sacct_ping(user)


@st.cache_data(ttl=10, show_spinner=False)
def slurm_sstat(job_id: str) -> tuple[int, str, str]:
    return sc.run_sstat(job_id)


@st.cache_data(ttl=30, show_spinner=False)
def slurm_seff(job_id: str) -> tuple[int, str, str]:
    return sc.run_seff(job_id)


@st.cache_data(ttl=15, show_spinner=False)
def slurm_sprio(user: str) -> tuple[int, str, str]:
    return sc.run_sprio(user)


@st.cache_data(ttl=60, show_spinner=False)
def slurm_scontrol_nodes() -> tuple[int, str, str]:
    return sc.run_scontrol_nodes()


@st.cache_data(ttl=120, show_spinner=False)
def slurm_scontrol_partitions() -> tuple[int, str, str]:
    return sc.run_scontrol_partitions()


@st.cache_data(ttl=20, show_spinner=False)
def slurm_cluster_health(user: str) -> list[sc.HealthCheck]:
    return sc.cluster_health_snapshot(user)


def main() -> None:
    _title = sc.env_monitor("APP_TITLE", "Monitor - Apuana")
    st.set_page_config(page_title=_title, layout="wide", initial_sidebar_state="expanded")

    st.markdown(
        """
<style>
  div[data-testid="stSidebarUserContent"] { padding-top: 0.5rem; }
  .main .block-container { padding-top: 1.2rem; padding-bottom: 2rem; }
  h1 { font-weight: 600; letter-spacing: -0.02em; }
</style>
""",
        unsafe_allow_html=True,
    )

    st.title(_title)
    st.caption(f"{sc._user()} - {os.uname().nodename} - {datetime.now():%Y-%m-%d %H:%M}")

    _def_log = sc.env_monitor("DEFAULT_LOG_OUT", str(Path.home() / "slurm-dashboard.out"))
    if "log_out" not in st.session_state:
        st.session_state.log_out = _def_log
    if "log_err" not in st.session_state:
        _po = Path(st.session_state.log_out)
        st.session_state.log_err = (
            str(_po.with_suffix(".err"))
            if str(_po).endswith(".out")
            else str(_po) + ".err"
        )

    if sc.REPO_ROOT == sc.DASHBOARD_DIR:
        pass  # Silent: does not affect functionality.

    with st.sidebar:
        st.markdown("### SLURM Queue")
        target_user = st.text_input(
            "User",
            value=sc._user(),
            placeholder=sc._user(),
        )
        st.markdown("### Global Queue")
        global_limit = st.number_input("Max rows (global)", 50, 2000, 200, step=50)

        with st.expander("Accounting history (sacct)", expanded=False):
            sacct_hours = st.slider("Hours", 6, 168, 48)
            sacct_lines = st.slider("Max rows", 20, 300, 80)

        st.markdown("### Log Reading")
        st.slider("Tail lines", 40, 600, 160, key="dash_tail_n")
        st.toggle("GPU via srun on the job", value=True, key="dash_gpu_srun")

        with st.expander("Environment & diagnostics", expanded=False):
            st.code(sc.env_block_compact(), language="text")
            sacct_err_hint = st.session_state.get("sacct_last_err", "")
            if st.button("Copy diagnostics", width="stretch"):
                st.session_state["diag_clip"] = sc.build_diag_text(sacct_err_hint)
            if st.session_state.get("diag_clip"):
                st.text_area("Copy from here", value=st.session_state["diag_clip"], height=120)

        with st.expander("SSH tunnel", expanded=False):
            st.code(
                f"ssh -N -L 8501:localhost:8501 {sc._user()}@{os.uname().nodename}",
                language="bash",
            )

    u = target_user.strip() or sc._user()

    # Global queue at the top: the first operational view for all Apuana users.
    code_g, out_g, err_g = slurm_squeue_global(int(global_limit))
    df_global = pd.DataFrame()
    if code_g == 0:
        hdr, rows = sc.parse_squeue_table(out_g)
        if hdr and rows:
            df_global = pd.DataFrame(rows[: int(global_limit)], columns=hdr)

    st.markdown("##### Global Apuana Queue")
    if code_g != 0:
        show_slurm_error_friendly("squeue (global)", err_g, out_g)
    elif df_global.empty:
        st.info("The global queue is empty.")
    else:
        st.dataframe(df_global, width="stretch", hide_index=True, height=420)

    st.divider()

    # Accounting health check avoids repeated sacct timeouts when slurmdbd is down.
    pg_c, pg_o, pg_e = slurm_sacct_ping(u)
    acct_ok = pg_c == 0 and not sc.accounting_failed(pg_e, pg_o)
    st.session_state["acct_ok"] = acct_ok
    if not acct_ok:
        st.warning(
            "Job history (`sacct`) is unavailable on this login node. "
            "Try another login node or contact the cluster administrator."
        )

    code_u, out_u, err_u = slurm_squeue_user(u)
    df_user = sc.squeue_to_df(out_u) if code_u == 0 else pd.DataFrame()
    if code_u != 0:
        show_slurm_error_friendly("squeue (utilizador)", err_u, out_u)

    _, uout, _ = slurm_squeue_users_raw()
    active_users = sc.active_users_from_squeue_stdout(uout)

    job_ids_from_queue: list[str] = []
    if not df_user.empty and df_user.shape[1] > 0:
        idcol = df_user.columns[0]
        job_ids_from_queue = [str(x) for x in df_user[idcol].tolist() if str(x)]

    tabs = st.tabs(["Overview", "Job", "GPU", "Logs", "Cluster", "Processes", "Advanced"])

    with tabs[0]:
        health = slurm_cluster_health(u)
        st.markdown("##### Operational Health")
        health_cols = st.columns(min(5, max(1, len(health))))
        badge = {"ok": "OK", "degraded": "DEGRADED", "unavailable": "UNAVAILABLE"}
        for i, item in enumerate(health):
            with health_cols[i % len(health_cols)]:
                with st.container(border=True):
                    st.markdown(f"**{item.name}**")
                    st.caption(badge.get(item.status, item.status.upper()))
                    st.write(item.summary)
                    if item.detail:
                        with st.expander("Details", expanded=False):
                            st.code(item.detail[:2000], language="text")

        st.divider()

        # KPIs from real data, with a single sacct call when accounting is available.
        dfb_hist = pd.DataFrame()
        sacct_hist_ok = False
        auo0, aue0 = "", ""
        if st.session_state.get("acct_ok", True):
            acu0, auo0, aue0 = slurm_sacct_user(u, int(sacct_hours), int(sacct_lines))
            st.session_state["sacct_last_err"] = aue0 or ""
            if acu0 == 0 and not sc.accounting_failed(aue0, auo0):
                dfb_hist = sc.parse_sacct_parsable2(auo0)
                sacct_hist_ok = True

        df_kpi = df_global if not df_global.empty else df_user
        n_run, n_pd = sc.queue_running_pending(df_kpi)
        n_bad = sc.sacct_problem_job_count(dfb_hist) if sacct_hist_ok else None

        k1, k2, k3 = st.columns(3)
        with k1:
            st.metric("Running", n_run)
        with k2:
            st.metric("Pending", n_pd)
        with k3:
            if n_bad is None:
                st.metric("Problems", "-")
            else:
                st.metric("Problems", n_bad)

        st.markdown(f"##### Queue - `{u}`")
        if df_user.empty:
            st.info("No queued jobs for this user.")
        else:
            st.dataframe(
                df_user,
                width="stretch",
                hide_index=True,
                height=min(420, 48 + 36 * len(df_user)),
            )
            if "ST" in df_user.columns or "S" in df_user.columns:
                col = "ST" if "ST" in df_user.columns else "S"
                vc = df_user[col].value_counts()
                st.caption(" - ".join(f"{k}: {v}" for k, v in vc.items()))

            # Show REASON for pending jobs.
            if not df_user.empty and "ST" in df_user.columns and (df_user["ST"] == "PD").any():
                pending_reasons = df_user[df_user["ST"] == "PD"]["REASON"].value_counts() if "REASON" in df_user.columns else None
                if pending_reasons is not None and not pending_reasons.empty:
                    st.caption(f"**Pending reasons:** {', '.join(f'{k}: {v}' for k, v in pending_reasons.items())}")

        st.markdown(f"##### History - `{u}`")
        if not st.session_state.get("acct_ok", True):
            st.info("History unavailable (accounting offline).")
        elif not sacct_hist_ok:
            show_slurm_error_friendly("sacct (history)", aue0, auo0)
        elif dfb_hist.empty:
            with st.expander("Empty response"):
                st.code(auo0 or "(empty)", language="text")
        else:
            st.dataframe(dfb_hist, width="stretch", hide_index=True)

    with tabs[1]:
        st.markdown("##### Inspect Job")
        st.radio(
            "JobID source",
            ["From queue", "Manual"],
            horizontal=True,
            key="dash_job_source",
            label_visibility="collapsed",
        )
        src = st.session_state.get("dash_job_source", "From queue")
        if src == "From queue":
            st.selectbox("Choose active job", [""] + job_ids_from_queue, key="dash_job_pick")
        else:
            st.text_input("JobID (ex.: 12345 or 12345.batch)", key="dash_job_manual", placeholder="Job ID")

        pick = str(st.session_state.get("dash_job_pick", "") or "")
        manual = str(st.session_state.get("dash_job_manual", "") or "")
        jid = sc.effective_job_id(src, pick, manual)

        if not jid:
            st.info("Select a job above.")
        else:
            st.success(f"**{jid}**")

            # Tabs for job details.
            job_tabs = st.tabs(["Details", "Efficiency", "Live stats", "History"])

            with job_tabs[0]:
                scode, sout, serr = slurm_scontrol(jid)
                if scode != 0:
                    show_slurm_error_friendly("scontrol", serr, sout)
                else:
                    with st.container(border=True):
                        st.markdown("###### scontrol show job")
                        st.code(sout or serr, language="bash")

            with job_tabs[1]:
                st.markdown("###### seff (efficiency)")
                ef_c, ef_o, ef_e = slurm_seff(jid)
                if ef_c == 0 and ef_o.strip():
                    st.code(ef_o, language="text")
                else:
                    st.info("Efficiency unavailable (job has not started yet or `seff` is not installed).")

            with job_tabs[2]:
                st.markdown("###### sstat (live stats)")
                st.caption("Only works with RUNNING jobs (MaxRSS, AveCPU, etc).")
                st_c, st_o, st_e = slurm_sstat(jid)
                if st_c == 0 and st_o.strip():
                    try:
                        df_sst = pd.read_csv(io.StringIO(st_o), sep="|")
                        st.dataframe(df_sst, width="stretch", hide_index=True)
                    except Exception:
                        st.code(st_o, language="text")
                else:
                    st.info("Unavailable (job is not RUNNING or the step has no allocated resources).")

            with job_tabs[3]:
                st.markdown("###### sacct -j")
                if not st.session_state.get("acct_ok", True):
                    st.info("History unavailable.")
                else:
                    acode, aout, aerr = slurm_sacct_job(jid, int(sacct_lines))
                    st.session_state["sacct_last_err"] = aerr or ""
                    if acode != 0 or sc.accounting_failed(aerr, aout):
                        show_slurm_error_friendly("sacct -j", aerr, aout)
                    else:
                        dfa = sc.parse_sacct_parsable2(aout)
                        if dfa.empty:
                            with st.expander("Empty response"):
                                st.code(aout or "(empty)", language="text")
                        else:
                            st.dataframe(dfa, width="stretch", hide_index=True)

    with tabs[2]:
        import matplotlib.pyplot as plt

        @st.fragment(run_every=timedelta(seconds=2))
        def _gpu_panel():
            src_l = st.session_state.get("dash_job_source", "From queue")
            pick_l = str(st.session_state.get("dash_job_pick", "") or "")
            manual_l = str(st.session_state.get("dash_job_manual", "") or "")
            jid_live = sc.effective_job_id(src_l, pick_l, manual_l)
            label = "nvidia-smi (login)"
            r = sc.nvsmi_query()
            if st.session_state.get("dash_gpu_srun", True) and jid_live:
                base = sc.job_base_id(jid_live)
                rs = sc.nvsmi_query_srun(base)
                if rs.ok and rs.stdout.strip():
                    r = rs
                    label = f"srun --immediate=1 --jobid={base}"
                elif rs.code == 124:
                    pass  # Silent: timeout is expected with --immediate.
            hb = st.columns([3, 2])
            with hb[0]:
                st.markdown(f"**{datetime.now():%H:%M:%S}**")
            with hb[1]:
                st.code(label, language="bash")
            if r.ok and r.stdout.strip():
                df_gpu = sc.parse_nvsmi_noheader(r.stdout)
                st.dataframe(df_gpu, width="stretch", hide_index=True)
                for _, row in df_gpu.iterrows():
                    try:
                        util = float(str(row.get("util_gpu", 0)).replace("%", "")) / 100.0
                    except (TypeError, ValueError):
                        util = 0.0
                    mu, mt = 0.0, 1.0
                    mem_r = 0.0
                    try:
                        mu = float(str(row.get("mem_used", 0)).replace(" MiB", "").replace(",", ""))
                        mt = float(str(row.get("mem_total", 1)).replace(" MiB", "").replace(",", ""))
                        mem_r = min(1.0, max(0.0, mu / mt)) if mt else 0.0
                    except (TypeError, ValueError):
                        pass
                    try:
                        temp = float(str(row.get("temp_gpu", 0)).replace(" C", ""))
                    except (TypeError, ValueError):
                        temp = 0.0
                    nm = str(row.get("name", "GPU"))
                    ix = str(row.get("index", "?"))
                    with st.container(border=True):
                        h1, h2 = st.columns([4, 1])
                        with h1:
                            st.markdown(f"**GPU {ix}** - `{nm[:56]}{'...' if len(nm) > 56 else ''}`")
                        with h2:
                            st.metric("Temp C", f"{temp:.0f}")
                        st.progress(min(1.0, max(0.0, util)), text=f"GPU utilization {util * 100:.0f}%")
                        st.progress(mem_r, text=f"VRAM {mu:.0f} / {mt:.0f} MiB")
                fig = sc.plot_gpu_util(df_gpu, f"Aggregate utilization - {label}")
                if fig is not None:
                    st.pyplot(fig)
                    plt.close(fig)
            else:
                st.warning("Could not obtain GPU CSV data.")
                with st.expander("nvidia-smi text"):
                    rr = sc.nvsmi_raw()
                    st.code(rr.stdout or rr.stderr, language="text")

        _gpu_panel()

    with tabs[3]:
        st.markdown("##### Log Files")
        candidates = sc.discover_log_candidates(50)
        if candidates:
            ncols = min(4, max(1, len(candidates)))
            for row_start in range(0, min(len(candidates), 12), ncols):
                row = candidates[row_start : row_start + ncols]
                cols = st.columns(len(row))
                for j, path in enumerate(row):
                    short = path.name[:28] + ("..." if len(path.name) > 28 else "")
                    if cols[j].button(short, key=f"logp_{row_start + j}", help=str(path)):
                        st.session_state.log_out = str(path)
                        st.session_state.log_err = str(path.with_suffix(".err"))
                        st.rerun()

        c1, c2 = st.columns(2)
        with c1:
            st.text_input("stdout (.out)", key="log_out")
        with c2:
            st.text_input("stderr (.err)", key="log_err")

        @st.fragment(run_every=timedelta(seconds=3))
        def _logs_panel():
            # Smart fallback when the configured file does not exist.
            pout_res, pout_msg = sc.validate_log_path(st.session_state.log_out)
            eout_res, eout_msg = sc.validate_log_path(st.session_state.log_err)

            # If the validated path does not exist, look for a fallback.
            if pout_res and not pout_res.exists():
                fb = sc.find_best_log_fallback(str(pout_res), ".out")
                if fb:
                    pout_res = fb
                    pout_msg = f"Using fallback (newest): {fb}"

            if eout_res and not eout_res.exists():
                fb_err = sc.find_best_log_fallback(str(eout_res), ".err")
                if fb_err:
                    eout_res = fb_err
                    eout_msg = f"Using fallback (newest): {fb_err}"

            g1, g2 = st.columns(2)
            with g1:
                st.markdown("###### stdout")
                if pout_res is None:
                    st.error(pout_msg)
                elif not pout_res.exists():
                    st.warning(f"File does not exist and no .out file was found: {pout_res}")
                else:
                    if "fallback" in pout_msg.lower():
                        st.info(pout_msg, icon="info")
                    st.caption(
                        f"{pout_res.name} - {pout_res.stat().st_size // 1024} KiB - "
                        f"{datetime.fromtimestamp(pout_res.stat().st_mtime):%H:%M:%S}"
                    )
                    tr = sc.run_tail(str(pout_res), int(st.session_state.get("dash_tail_n", 160)))
                    st.code(tr.stdout or tr.stderr, language="text", line_numbers=True)

            with g2:
                st.markdown("###### stderr")
                if eout_res is None:
                    st.error(eout_msg)
                elif not eout_res.exists():
                    st.warning(f"File does not exist and no .err file was found: {eout_res}")
                else:
                    if "fallback" in eout_msg.lower():
                        st.info(eout_msg, icon="info")
                    st.caption(
                        f"{eout_res.name} - {eout_res.stat().st_size // 1024} KiB - "
                        f"{datetime.fromtimestamp(eout_res.stat().st_mtime):%H:%M:%S}"
                    )
                    tr = sc.run_tail(str(eout_res), int(st.session_state.get("dash_tail_n", 160)))
                    st.code(tr.stdout or tr.stderr, language="text", line_numbers=True)

        _logs_panel()

    with tabs[4]:
        import matplotlib.pyplot as plt

        code_si, so, se = slurm_sinfo()
        if code_si != 0:
            show_slurm_error_friendly("sinfo", se, so)
        else:
            try:
                dfi = pd.read_csv(io.StringIO(so), sep=r"\s+")
            except Exception:
                dfi = None
            if dfi is not None and not dfi.empty:
                st.dataframe(dfi, width="stretch", hide_index=True)
                parts_pb, fr_pb = sc.partition_idle_series(dfi)
                if parts_pb:
                    st.markdown("##### Partition occupancy")
                    for pname, frac in zip(parts_pb, fr_pb):
                        st.progress(
                            float(frac),
                            text=f"{pname} - ~{int(round(frac * 100))}% idle",
                        )
                if len(dfi) <= 24:
                    fig2 = sc.plot_partition_idle(dfi, "Idle by partition (bars)")
                    if fig2 is not None:
                        st.pyplot(fig2)
                        plt.close(fig2)
                    if 2 <= len(dfi) <= 20:
                        fig_h = sc.plot_partition_heatmap(dfi, "Idle by partition (heatmap)")
                        if fig_h is not None:
                            st.pyplot(fig_h)
                            plt.close(fig_h)
            else:
                with st.expander("sinfo (text)"):
                    st.code(so or se, language="text")

    with tabs[5]:
        st.markdown("##### Processes")

        painel_sh = sc.DASHBOARD_DIR / "painel_slurm.sh"
        run_here = sc.DASHBOARD_DIR / "run_slurm_monitor.sh"
        run_root = sc.REPO_ROOT / "run_slurm_monitor.sh"
        run_legacy = sc.REPO_ROOT / "run_apuana_monitor.sh"
        cmd_painel = f"bash {painel_sh}"
        if run_root.is_file():
            cmd_wrapped = f"bash {run_root} --painel"
        elif run_legacy.is_file():
            cmd_wrapped = f"bash {run_legacy} --painel"
        elif run_here.is_file():
            cmd_wrapped = f"bash {run_here} --painel"
        else:
            cmd_wrapped = cmd_painel

        st.markdown("##### tmux Panel Snapshot")
        auto_snap = st.toggle("Auto-refresh (~20 s)", value=True, key="dash_painel_snap_auto")
        skip_ac = not st.session_state.get("acct_ok", True)

        def _build_painel_snap() -> dict[str, tuple[bool, str]]:
            return sc.painel_like_snapshot(
                u,
                str(st.session_state.get("log_out", "")),
                str(st.session_state.get("log_err", "")),
                int(st.session_state.get("dash_tail_n", 160)),
                int(sacct_hours),
                min(24, int(sacct_lines)),
                skip_ac,
            )

        def _render_snap_grid(snap: dict[str, tuple[bool, str]]) -> None:
            st.caption(f"Updated: {datetime.now():%H:%M:%S}")
            a, b = st.columns(2)
            with a:
                with st.container(border=True):
                    st.markdown("**1 - Queue (squeue)**")
                    _ok, txt = snap["queue"]
                    st.code(txt[:14000], language="bash")
            with b:
                with st.container(border=True):
                    st.markdown("**2 - Logs (tail)**")
                    _ok2, txt2 = snap["logs"]
                    st.code(txt2[:14000], language="text")
            c, d = st.columns(2)
            with c:
                with st.container(border=True):
                    st.markdown("**3 - GPU / context**")
                    _ok3, txt3 = snap["gpu"]
                    st.code(txt3[:14000], language="text")
            with d:
                with st.container(border=True):
                    st.markdown("**4 - sacct**")
                    ok4, txt4 = snap["sacct"]
                    if not ok4:
                        st.warning("sacct failed or accounting is offline.")
                    st.code(txt4[:14000], language="text")

        if auto_snap:

            @st.fragment(run_every=timedelta(seconds=20))
            def _painel_snap_fragment():
                _render_snap_grid(_build_painel_snap())

            _painel_snap_fragment()
        else:
            if st.button("Generate snapshot now", key="dash_painel_snap_btn"):
                st.session_state["_painel_snap_once"] = _build_painel_snap()
            if st.session_state.get("_painel_snap_once"):
                _render_snap_grid(st.session_state["_painel_snap_once"])

        with st.expander("tmux panel (SSH terminal)", expanded=False):
            st.code(cmd_wrapped, language="bash")
            st.code(cmd_painel, language="bash")

        c1, c2, c3 = st.columns([1, 1, 2])
        with c1:
            st.number_input("Max rows", 20, 400, 80, step=10, key="dash_proc_limit")
        with c2:
            st.toggle("Auto-refresh (4 s)", value=False, key="dash_proc_autorefresh")
        with c3:
            st.text_input("Filter COMMAND", placeholder="ex.: python, slurm", key="dash_proc_filter")

        def _render_ps_table(label: str, stdout: str, ok: bool, err: str) -> None:
            st.markdown(f"###### {label}")
            if not ok:
                st.error(err[:2000] if err else "ps failed")
                return
            lim = int(st.session_state.get("dash_proc_limit", 80))
            df_ps = sc.ps_aux_to_dataframe(stdout, max_rows=lim)
            if df_ps.empty:
                st.code(stdout[:8000], language="text")
                return
            q = str(st.session_state.get("dash_proc_filter", "") or "").strip().lower()
            if q:
                df_ps = df_ps[df_ps["COMMAND"].str.lower().str.contains(q, na=False)]
            st.dataframe(
                df_ps,
                width="stretch",
                hide_index=True,
                height=min(520, 80 + 28 * len(df_ps)),
            )

        if st.session_state.get("dash_proc_autorefresh", False):

            @st.fragment(run_every=timedelta(seconds=4))
            def _proc_live():
                pr = sc.ps_mem_snapshot()
                _render_ps_table("ps aux - login", pr.stdout, pr.ok, pr.stderr)

            _proc_live()
        else:
            pr0 = sc.ps_mem_snapshot()
            _render_ps_table("ps aux - login", pr0.stdout, pr0.ok, pr0.stderr)

        with st.expander("top -bn1 (raw text)"):
            tr = sc.top_snapshot()
            st.code(tr.stdout[:8000] if tr.ok else tr.stderr, language="text")

        if st.checkbox("ps table on the job node (srun --immediate)", value=False):
            src_p = st.session_state.get("dash_job_source", "From queue")
            pick_p = str(st.session_state.get("dash_job_pick", "") or "")
            man_p = str(st.session_state.get("dash_job_manual", "") or "")
            jx = sc.effective_job_id(src_p, pick_p, man_p)
            if not jx:
                st.warning("Define the job in the **Job** tab.")
            else:
                pr2 = sc.ps_via_srun(sc.job_base_id(jx))
                if not pr2.ok:
                    show_slurm_error_friendly("srun ps", pr2.stderr, pr2.stdout)
                else:
                    _render_ps_table(
                        f"ps aux - job {sc.job_base_id(jx)}",
                        pr2.stdout,
                        True,
                        "",
                    )

    with tabs[6]:
        st.markdown("##### Advanced SLURM Commands")

        adv_tabs = st.tabs(["sprio (priority)", "Nodes", "Partitions"])

        with adv_tabs[0]:
            st.markdown("###### sprio - queue priority")
            st.caption("Shows why some pending jobs are prioritized over others.")
            sp_c, sp_o, sp_e = slurm_sprio(u)
            if sp_c == 0 and sp_o.strip():
                st.code(sp_o, language="text")
            else:
                st.info("No pending jobs or `sprio` is unavailable.")

        with adv_tabs[1]:
            st.markdown("###### scontrol show nodes")
            st.caption("Full node hardware and state for the cluster (CPU, RAM, GPU, state).")
            if st.button("Load node info", key="load_nodes"):
                st.session_state["nodes_data"] = slurm_scontrol_nodes()
            if st.session_state.get("nodes_data"):
                n_c, n_o, n_e = st.session_state["nodes_data"]
                if n_c == 0:
                    with st.expander("Show full details", expanded=False):
                        st.code(n_o[:50000], language="text")
                else:
                    show_slurm_error_friendly("scontrol show nodes", n_e, n_o)

        with adv_tabs[2]:
            st.markdown("###### scontrol show partition")
            st.caption("Time limits, QoS, nodes per partition - real cluster configuration.")
            if st.button("Load partition info", key="load_parts"):
                st.session_state["parts_data"] = slurm_scontrol_partitions()
            if st.session_state.get("parts_data"):
                p_c, p_o, p_e = st.session_state["parts_data"]
                if p_c == 0:
                    with st.expander("Show full details", expanded=False):
                        st.code(p_o[:50000], language="text")
                else:
                    show_slurm_error_friendly("scontrol show partition", p_e, p_o)


if __name__ == "__main__":
    main()
