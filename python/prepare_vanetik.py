#!/usr/bin/env python3
"""Normalize the public Vanetik/Kogan vacancy-resume ranking dataset."""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


def read_docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
    paragraphs: list[str] = []
    for paragraph in document.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
        text = "".join(
            node.text or ""
            for node in paragraph.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")
        ).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


def parse_rankings(text: str, name: str) -> list[list[int]]:
    marker = f"{name}="
    if marker not in text:
        raise ValueError(f"Missing {name} in annotation file")
    section = text.split(marker, 1)[1]
    next_marker = "ANNOTATOR_2_RANKINGS=" if name == "ANNOTATOR_1_RANKINGS" else None
    if next_marker:
        section = section.split(next_marker, 1)[0]
    section = re.sub(r"#.*?$", "", section, flags=re.MULTILINE).strip()
    rows = ast.literal_eval(section)
    if not isinstance(rows, list) or len(rows) != 30:
        raise ValueError(f"Expected 30 ranking rows for {name}")
    for row_number, row in enumerate(rows, 1):
        if (
            not isinstance(row, list)
            or len(row) != 5
            or any(not isinstance(rank, int) or rank < 1 or rank > 5 for rank in row)
        ):
            raise ValueError(f"Invalid rank values in {name}, row {row_number}")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("data/raw/vanetik-vacancy-resume"))
    parser.add_argument("--output", type=Path, default=Path("data/normalized/vanetik.json"))
    args = parser.parse_args()
    source = args.source

    csv_path = source / "5_vacancies.csv"
    annotation_path = source / "annotations-for-the-first-30-vacancies.txt"
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        vacancies = list(csv.DictReader(handle))
    if len(vacancies) != 5:
        raise ValueError(f"Expected 5 vacancies, found {len(vacancies)}")

    jobs = []
    for row in vacancies:
        job_id = str(row.get("id", "")).strip()
        title = str(row.get("job_title", "")).strip()
        description = str(row.get("job_description", "")).strip()
        if not job_id or not title or not description:
            raise ValueError("Vacancy is missing an ID, title, or job description")
        jobs.append({"id": job_id, "title": title, "description": description})

    candidates = []
    source_files = [csv_path, annotation_path, source / "annotation_instructions.docx"]
    for cv_number in range(1, 31):
        resume_path = source / "CV" / f"{cv_number}.docx"
        if not resume_path.exists():
            raise FileNotFoundError(f"Missing labeled resume file CV/{cv_number}.docx")
        resume_text = read_docx_text(resume_path)
        if len(resume_text) < 100:
            raise ValueError(f"Extracted resume CV-{cv_number:02d} is unexpectedly short")
        candidates.append({"id": f"CV-{cv_number:02d}", "resumeText": resume_text})
        source_files.append(resume_path)

    annotation_text = annotation_path.read_text(encoding="utf-8")
    annotator_1 = parse_rankings(annotation_text, "ANNOTATOR_1_RANKINGS")
    annotator_2 = parse_rankings(annotation_text, "ANNOTATOR_2_RANKINGS")
    annotations = [
        {
            "candidateId": f"CV-{index + 1:02d}",
            "annotator1": annotator_1[index],
            "annotator2": annotator_2[index],
        }
        for index in range(30)
    ]

    non_strict_rows = [
        {"annotator": annotator, "candidateId": f"CV-{index + 1:02d}"}
        for annotator, rows in (("annotator1", annotator_1), ("annotator2", annotator_2))
        for index, row in enumerate(rows)
        if sorted(row) != [1, 2, 3, 4, 5]
    ]

    hasher = hashlib.sha256()
    for path in sorted(source_files, key=lambda item: item.relative_to(source).as_posix()):
        relative = path.relative_to(source).as_posix()
        hasher.update(relative.encode("utf-8"))
        hasher.update(path.read_bytes())

    dataset: dict[str, Any] = {
        "source": "NataliaVanetik/vacancy-resume-matching-dataset",
        "sourceUrl": "https://github.com/NataliaVanetik/vacancy-resume-matching-dataset",
        "sourceLicense": "GPL-3.0",
        "datasetVersionOrHash": hasher.hexdigest(),
        "annotationDirection": "For each resume, rank five vacancies from best to worst.",
        "jobs": jobs,
        "candidates": candidates,
        "annotations": annotations,
        "nonStrictRankingRows": non_strict_rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.output.chmod(0o600)
    print(
        json.dumps(
            {
                "jobs": len(jobs),
                "labeledCandidates": len(candidates),
                "scoredPairs": len(jobs) * len(candidates),
                "annotators": 2,
                "nonStrictRankingRows": non_strict_rows,
                "datasetVersionOrHash": dataset["datasetVersionOrHash"],
                "output": str(args.output),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
