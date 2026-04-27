# RAG PDFs — single folder for this project

Examples:

```text
samples/rag_pdfs/
  procurement-guide.pdf
  gpu-reference/
    vendor-whitepaper.pdf
```

Ingest from **`backend/`**:

```powershell
python -m tools.rag_ingest --pdf samples/rag_pdfs/procurement-guide.pdf
python -m tools.rag_ingest --pdf samples/rag_pdfs/gpu-reference/vendor-whitepaper.pdf
```

All **`*.pdf` files anywhere under `samples/rag_pdfs/`** are **gitignored** so large or licensed files stay on your machine only. Only this `README.md` (and `.gitkeep`) are tracked in git.
