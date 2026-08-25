"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";

const ALLOWED_EXTENSIONS = ["xlsx", "csv", "txt"];
const MAX_ACCEPTED_FILES = 10;
const LARGE_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_LIMIT_ERROR_ID = "accepted-limit";

function getFileExtension(fileName) {
	const parts = fileName.toLowerCase().split(".");
	return parts.length > 1 ? parts.pop() : "";
}

function formatFileSize(bytes) {
	if (!bytes && bytes !== 0) return "Unknown";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileTypeIcon(file) {
	const extension = getFileExtension(file.name);
	if (extension === "xlsx") return "📊";
	if (extension === "csv") return "🧾";
	if (extension === "txt") return "📄";
	return "📁";
}

function getDetailedErrorMessage(file, reason = "format") {
	if (reason === "format") {
		return `❌ ${file.name} - Unsupported file format. Please upload .xlsx, .csv, or .txt files only.`;
	}

	if (reason === "empty") {
		return `❌ ${file.name} - File is empty. Please upload a file with data.`;
	}

	if (reason === "duplicate_name") {
		return `❌ ${file.name} - A file with this name is already selected. Remove it first if you want to replace it.`;
	}

	return `❌ ${file.name} - File is empty or contains no data. Please check your file and try again.`;
}

function parseCsvLine(line) {
	const cells = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];

		if (char === '"') {
			const nextChar = line[i + 1];
			if (inQuotes && nextChar === '"') {
				current += '"';
				i += 1;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (char === "," && !inQuotes) {
			cells.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}

	cells.push(current.trim());
	return cells;
}

function getCellColumnIndex(cellRef = "") {
	const match = cellRef.match(/[A-Z]+/i);
	if (!match) return -1;

	const letters = match[0].toUpperCase();
	let value = 0;

	for (let i = 0; i < letters.length; i += 1) {
		value = value * 26 + (letters.charCodeAt(i) - 64);
	}

	return value - 1;
}

async function inflateDeflateRaw(compressedData) {
	if (typeof DecompressionStream === "undefined") {
		throw new Error("Browser does not support XLSX decompression.");
	}

	const stream = new Blob([compressedData]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	const decompressed = await new Response(stream).arrayBuffer();
	return new Uint8Array(decompressed);
}

async function decodeZipEntry(entry) {
	if (entry.compressionMethod === 0) {
		return entry.compressedData;
	}

	if (entry.compressionMethod === 8) {
		return inflateDeflateRaw(entry.compressedData);
	}

	throw new Error(`Unsupported XLSX compression method: ${entry.compressionMethod}`);
}

function parseZipEntries(arrayBuffer) {
	const bytes = new Uint8Array(arrayBuffer);
	const view = new DataView(arrayBuffer);
	const decoder = new TextDecoder("utf-8");
	const entries = new Map();
	let offset = 0;

	while (offset + 30 <= bytes.length) {
		const signature = view.getUint32(offset, true);
		if (signature !== 0x04034b50) {
			offset += 1;
			continue;
		}

		const flags = view.getUint16(offset + 6, true);
		const compressionMethod = view.getUint16(offset + 8, true);
		const compressedSize = view.getUint32(offset + 18, true);
		const fileNameLength = view.getUint16(offset + 26, true);
		const extraLength = view.getUint16(offset + 28, true);

		const nameStart = offset + 30;
		const nameEnd = nameStart + fileNameLength;
		const fileName = decoder.decode(bytes.slice(nameStart, nameEnd));

		const dataStart = nameEnd + extraLength;

		if ((flags & 0x0008) !== 0) {
			break;
		}

		const dataEnd = dataStart + compressedSize;
		if (dataEnd > bytes.length) break;

		entries.set(fileName, {
			fileName,
			compressionMethod,
			compressedData: bytes.slice(dataStart, dataEnd),
		});

		offset = dataEnd;
	}

	return entries;
}

function parseSharedStrings(sharedStringsXml) {
	const parser = new DOMParser();
	const doc = parser.parseFromString(sharedStringsXml, "application/xml");
	const nodes = Array.from(doc.getElementsByTagName("si"));

	return nodes.map((siNode) => {
		const tNodes = Array.from(siNode.getElementsByTagName("t"));
		if (!tNodes.length) return "";
		return tNodes.map((tNode) => tNode.textContent || "").join("");
	});
}

function parseWorksheetPreview(worksheetXml, sharedStrings, maxRows = 10, maxCols = 5) {
	const parser = new DOMParser();
	const doc = parser.parseFromString(worksheetXml, "application/xml");
	const rowNodes = Array.from(doc.getElementsByTagName("row")).slice(0, maxRows);

	return rowNodes.map((rowNode) => {
		const rowValues = new Array(maxCols).fill("");
		const cellNodes = Array.from(rowNode.getElementsByTagName("c"));

		cellNodes.forEach((cellNode) => {
			const ref = cellNode.getAttribute("r") || "";
			const colIndex = getCellColumnIndex(ref);
			if (colIndex < 0 || colIndex >= maxCols) return;

			const type = cellNode.getAttribute("t");
			const valueNode = cellNode.getElementsByTagName("v")[0];

			if (!valueNode) {
				const inlineNode = cellNode.getElementsByTagName("t")[0];
				rowValues[colIndex] = inlineNode?.textContent || "";
				return;
			}

			const rawValue = valueNode.textContent || "";

			if (type === "s") {
				const sharedIndex = Number.parseInt(rawValue, 10);
				rowValues[colIndex] = sharedStrings[sharedIndex] || "";
			} else {
				rowValues[colIndex] = rawValue;
			}
		});

		return rowValues;
	});
}

async function previewXlsxFile(file) {
	const buffer = await file.arrayBuffer();
	const entries = parseZipEntries(buffer);
	const decoder = new TextDecoder("utf-8");

	const workbookEntry = entries.get("xl/workbook.xml");
	if (!workbookEntry) {
		return {
			sheetNames: [],
			rows: [],
			note: "Unable to read workbook metadata from this .xlsx file.",
		};
	}

	const workbookXmlBytes = await decodeZipEntry(workbookEntry);
	const workbookXml = decoder.decode(workbookXmlBytes);

	const relsEntry = entries.get("xl/_rels/workbook.xml.rels");
	const relsMap = new Map();

	if (relsEntry) {
		const relsXmlBytes = await decodeZipEntry(relsEntry);
		const relsXml = decoder.decode(relsXmlBytes);
		const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");
		const relationshipNodes = Array.from(relsDoc.getElementsByTagName("Relationship"));

		relationshipNodes.forEach((relNode) => {
			const id = relNode.getAttribute("Id");
			const target = relNode.getAttribute("Target");
			if (id && target) relsMap.set(id, target);
		});
	}

	const workbookDoc = new DOMParser().parseFromString(workbookXml, "application/xml");
	const sheetNodes = Array.from(workbookDoc.getElementsByTagName("sheet"));

	const sheetNames = sheetNodes
		.map((sheetNode) => sheetNode.getAttribute("name") || "")
		.filter(Boolean);

	const firstSheetNode = sheetNodes[0];
	if (!firstSheetNode) {
		return {
			sheetNames,
			rows: [],
			note: "Workbook has no sheets to preview.",
		};
	}

	const firstSheetRelId = firstSheetNode.getAttribute("r:id");
	const firstSheetTarget = firstSheetRelId ? relsMap.get(firstSheetRelId) : null;

	if (!firstSheetTarget) {
		return {
			sheetNames,
			rows: [],
			note: "Unable to resolve first sheet preview from workbook relationships.",
		};
	}

	const normalizedTarget = firstSheetTarget.startsWith("/")
		? firstSheetTarget.slice(1)
		: `xl/${firstSheetTarget.replace(/^\.\//, "")}`;

	const sheetEntry = entries.get(normalizedTarget);
	if (!sheetEntry) {
		return {
			sheetNames,
			rows: [],
			note: "Unable to locate first worksheet data in the file.",
		};
	}

	const sharedStringsEntry = entries.get("xl/sharedStrings.xml");
	let sharedStrings = [];

	if (sharedStringsEntry) {
		const sharedStringBytes = await decodeZipEntry(sharedStringsEntry);
		const sharedStringXml = decoder.decode(sharedStringBytes);
		sharedStrings = parseSharedStrings(sharedStringXml);
	}

	const sheetXmlBytes = await decodeZipEntry(sheetEntry);
	const sheetXml = decoder.decode(sheetXmlBytes);
	const rows = parseWorksheetPreview(sheetXml, sharedStrings, 10, 5);

	return {
		sheetNames,
		rows,
		note: rows.length ? null : "First sheet appears to have no visible data in the first rows.",
	};
}

function PreviewModal({ previewState, onClose }) {
	if (!previewState?.file) return null;

	const { file, status, warnings, errors, data, loading, loadError } = previewState;
	const extension = getFileExtension(file.name);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-deep-violet-blue/50 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="file-preview-title"
		>
			<div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-lavander bg-cream shadow-md">
				<div className="flex items-center justify-between border-b border-lavander bg-lavander px-6 py-4">
					<div>
						<h3 id="file-preview-title" className="font-serif text-lg text-deep-violet-blue">
							File Preview
						</h3>
						<p className="text-sm text-deep-violet-blue/80">
							{file.name}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg border border-deep-violet-blue bg-deep-violet-blue px-4 py-2 text-sm font-medium text-white transition hover:bg-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
						aria-label="Close file preview"
					>
						Close
					</button>
				</div>

				<div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
					<div className="grid gap-4 rounded-lg border border-lavander bg-white p-4 text-sm shadow-sm md:grid-cols-2">
						<p className="text-deep-violet-blue">
							<span className="font-semibold text-deep-violet-blue">Size:</span> {formatFileSize(file.size)}
						</p>
						<p className="text-deep-violet-blue">
							<span className="font-semibold text-deep-violet-blue">Type:</span> .{extension || "unknown"}
						</p>
						<p className="text-deep-violet-blue">
							<span className="font-semibold text-deep-violet-blue">Status:</span>{" "}
							{status === "accepted" ? "✓ Accepted" : "✗ Rejected"}
						</p>
						<p className="text-deep-violet-blue">
							<span className="font-semibold text-deep-violet-blue">Warnings:</span> {warnings.length}
						</p>
					</div>

					{!!errors.length && (
						<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
							{errors.map((message) => (
								<p key={message}>{message}</p>
							))}
						</div>
					)}

					{!!warnings.length && (
						<div className="rounded-lg border border-violet bg-lavander p-4 text-sm text-deep-violet-blue">
							{warnings.map((message) => (
								<p key={message}>{message}</p>
							))}
						</div>
					)}

					{loading && (
						<div className="rounded-lg border border-lavander bg-white p-5 text-deep-violet-blue shadow-sm">
							Loading preview...
						</div>
					)}

					{loadError && (
						<div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700 shadow-sm">
							{loadError}
						</div>
					)}

					{!loading && !loadError && data?.kind === "text" && (
						<div className="rounded-lg border border-lavander bg-white p-4 shadow-sm">
							<p className="mb-3 text-sm font-semibold text-deep-violet-blue">First 20 lines</p>
							<div className="overflow-x-auto rounded-md border border-lavander">
								<table className="min-w-full text-left text-sm">
									<thead className="bg-lavander text-deep-violet-blue">
										<tr>
											<th className="px-3 py-2">Line</th>
											<th className="px-3 py-2">Content</th>
										</tr>
									</thead>
									<tbody className="text-deep-violet-blue">
										{data.lines.map((line, index) => (
											<tr key={`${line}-${index}`} className="border-t border-lavander">
												<td className="px-3 py-2 align-top font-medium">{index + 1}</td>
												<td className="px-3 py-2 whitespace-pre-wrap break-words">{line || "(empty line)"}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{!loading && !loadError && data?.kind === "csv" && (
						<div className="rounded-lg border border-lavander bg-white p-4 shadow-sm">
							<p className="mb-3 text-sm font-semibold text-deep-violet-blue">First 20 rows</p>
							<div className="overflow-x-auto rounded-md border border-lavander">
								<table className="min-w-full text-left text-sm">
									<tbody className="text-deep-violet-blue">
										{data.rows.map((row, rowIndex) => (
											<tr key={`row-${rowIndex}`} className="border-t border-lavander">
												<td className="bg-cream px-3 py-2 align-top font-medium text-deep-violet-blue">
													{rowIndex + 1}
												</td>
												{row.map((cell, cellIndex) => (
													<td key={`cell-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top">
														{cell || " "}
													</td>
												))}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{!loading && !loadError && data?.kind === "xlsx" && (
						<div className="space-y-4 rounded-lg border border-lavander bg-white p-4 shadow-sm">
							<div>
								<p className="text-sm font-semibold text-deep-violet-blue">Sheet names</p>
								<p className="mt-2 text-sm text-deep-violet-blue">
									{data.sheetNames.length ? data.sheetNames.join(", ") : "No sheet names found"}
								</p>
							</div>

							<div>
								<p className="mb-3 text-sm font-semibold text-deep-violet-blue">
									First sheet preview (10 rows x 5 columns)
								</p>
								<div className="overflow-x-auto rounded-md border border-lavander">
									<table className="min-w-full text-left text-sm">
										<tbody className="text-deep-violet-blue">
											{data.rows.map((row, rowIndex) => (
												<tr key={`xlsx-row-${rowIndex}`} className="border-t border-lavander">
													<td className="bg-cream px-3 py-2 align-top font-medium text-deep-violet-blue">
														{rowIndex + 1}
													</td>
													{row.map((cell, cellIndex) => (
														<td key={`xlsx-cell-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top">
															{cell || " "}
														</td>
													))}
												</tr>
											))}
											{!data.rows.length && (
												<tr>
													<td className="px-3 py-3 text-deep-violet-blue/80" colSpan={6}>
														No tabular rows found in the first sheet.
													</td>
												</tr>
											)}
										</tbody>
									</table>
								</div>
							</div>

							{data.note && (
								<p className="text-sm text-deep-violet-blue/80">{data.note}</p>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export default function FileUpload({ onUpload, disabled = false }) {
	const [selectedFiles, setSelectedFiles] = useState([]);
	const [fileItems, setFileItems] = useState([]);
	const [isDragging, setIsDragging] = useState(false);
	const [previewFile, setPreviewFile] = useState(null);
	const [previewData, setPreviewData] = useState(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewError, setPreviewError] = useState("");
	const inputRef = useRef(null);

	const isProcessing = disabled;

	const isValidFileFormat = useCallback((file) => {
		const extension = getFileExtension(file.name);
		return ALLOWED_EXTENSIONS.includes(extension);
	}, []);

	const isValidFileContent = useCallback(async (file) => {
		if (file.size === 0) {
			return { valid: false, reason: "empty" };
		}

		const extension = getFileExtension(file.name);

		if (extension === "txt" || extension === "csv") {
			const text = await file.text();
			if (!text.trim()) {
				return { valid: false, reason: "empty" };
			}
			return { valid: true, reason: null };
		}

		if (extension === "xlsx") {
			try {
				const xlsxPreview = await previewXlsxFile(file);
				const hasSheet = xlsxPreview.sheetNames.length > 0;
				const hasRows = xlsxPreview.rows.some((row) => row.some((cell) => String(cell || "").trim()));

				if (!hasSheet || !hasRows) {
					return { valid: false, reason: "empty_or_no_data" };
				}

				return { valid: true, reason: null };
			} catch {
				if (file.size > 0) {
					return { valid: true, reason: null };
				}
				return { valid: false, reason: "empty" };
			}
		}

		return { valid: true, reason: null };
	}, []);

	const buildFileItem = useCallback((file, status, itemErrors, warnings) => {
		const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`;
		return {
			id,
			file,
			status,
			errors: itemErrors,
			warnings,
		};
	}, []);

	const processFiles = useCallback(
		async (incomingFiles) => {
			if (isProcessing) return;

			const filesArray = Array.from(incomingFiles || []);
			if (!filesArray.length) return;

			if (filesArray.length > MAX_FILES_PER_ACTION) {
				setErrors((prev) => [
					...prev,
					{
						fileName: "Upload action",
						message: `❌ Upload action - Too many files selected. Please upload between 1 and ${MAX_FILES_PER_ACTION} files per upload action.`,
						itemId: `bulk-${Date.now()}`,
					},
				]);
				return;
			}

			const acceptedNames = new Set(
				fileItems.filter((item) => item.status === "accepted").map((item) => item.file.name)
			);

			const accepted = [];
			const nextItems = [];

			for (const file of filesArray) {
				const itemWarnings = [];
				const itemErrors = [];

				if (acceptedNames.has(file.name)) {
					itemErrors.push(getDetailedErrorMessage(file, "duplicate_name"));
				} else {
					if (file.size > LARGE_FILE_SIZE_BYTES) {
						itemWarnings.push(`⚠️ ${file.name} - File is over 10MB. Upload may be slow.`);
					}

					if (!isValidFileFormat(file)) {
						itemErrors.push(getDetailedErrorMessage(file, "format"));
					} else {
						const contentValidation = await isValidFileContent(file);
						if (!contentValidation.valid) {
							itemErrors.push(getDetailedErrorMessage(file, contentValidation.reason || "empty"));
						}
					}
				}

				const status = itemErrors.length ? "rejected" : "accepted";
				const item = buildFileItem(file, status, itemErrors, itemWarnings);
				nextItems.push(item);

				if (status === "accepted") {
					accepted.push(file);
					acceptedNames.add(file.name);
				} else {
					itemErrors.forEach((message) => {
						nextErrors.push({ fileName: file.name, message, itemId: item.id });
					});
				}
			}

			setFileItems((prev) => [...prev, ...nextItems]);
			setSelectedFiles((prev) => [...prev, ...accepted]);
		},
		[buildFileItem, fileItems, isProcessing, isValidFileContent, isValidFileFormat]
	);

	const handleInputChange = useCallback(
		async (event) => {
			await processFiles(event.target.files);
			event.target.value = "";
		},
		[processFiles]
	);

	const handleDragOver = useCallback((event) => {
		event.preventDefault();
		if (!isProcessing) {
			setIsDragging(true);
		}
	}, [isProcessing]);

	const handleDragLeave = useCallback((event) => {
		event.preventDefault();
		setIsDragging(false);
	}, []);

	const handleDrop = useCallback(
		async (event) => {
			event.preventDefault();
			setIsDragging(false);
			await processFiles(event.dataTransfer.files);
		},
		[processFiles]
	);

	const handleBrowseClick = useCallback(() => {
		if (isProcessing) return;
		inputRef.current?.click();
	}, [isProcessing]);

	const removeFile = useCallback(
		(itemId) => {
			setFileItems((prevItems) => {
				const target = prevItems.find((item) => item.id === itemId);

				if (!target) return prevItems;

				if (target.status === "accepted") {
					setSelectedFiles((prevSelected) => {
						const index = prevSelected.findIndex(
							(file) =>
								file === target.file ||
								(file.name === target.file.name &&
									file.size === target.file.size &&
									file.lastModified === target.file.lastModified)
						);

						if (index < 0) return prevSelected;

						const updated = [...prevSelected];
						updated.splice(index, 1);
						return updated;
					});
				}

				if (previewFile?.id === itemId) {
					setPreviewFile(null);
					setPreviewData(null);
					setPreviewError("");
					setPreviewLoading(false);
				}

				return prevItems.filter((item) => item.id !== itemId);
			});
		},
		[previewFile]
	);

	const removeAllFiles = useCallback(() => {
		setFileItems([]);
		setSelectedFiles([]);
		setPreviewFile(null);
		setPreviewData(null);
		setPreviewError("");
		setPreviewLoading(false);
	}, []);

	const openPreview = useCallback(async (item) => {
		setPreviewFile(item);
		setPreviewData(null);
		setPreviewError("");
		setPreviewLoading(true);

		try {
			const extension = getFileExtension(item.file.name);

			if (extension === "txt") {
				const text = await item.file.text();
				const lines = text.split(/\r?\n/).slice(0, 20);
				setPreviewData({ kind: "text", lines });
			} else if (extension === "csv") {
				const text = await item.file.text();
				const rows = text
					.split(/\r?\n/)
					.filter((line) => line.trim().length > 0)
					.slice(0, 20)
					.map((line) => parseCsvLine(line));
				setPreviewData({ kind: "csv", rows });
			} else if (extension === "xlsx") {
				const xlsxData = await previewXlsxFile(item.file);
				setPreviewData({ kind: "xlsx", ...xlsxData });
			} else {
				setPreviewData({ kind: "text", lines: ["Preview not available for this file type."] });
			}
		} catch {
			setPreviewError("Unable to preview this file. Please verify the file is readable and try again.");
		} finally {
			setPreviewLoading(false);
		}
	}, []);

	const closePreview = useCallback(() => {
		setPreviewFile(null);
		setPreviewData(null);
		setPreviewError("");
		setPreviewLoading(false);
	}, []);

	const handleUpload = useCallback(() => {
		if (isProcessing || !selectedFiles.length || selectedFiles.length > MAX_ACCEPTED_FILES) return;
		onUpload?.(selectedFiles);
	}, [isProcessing, onUpload, selectedFiles]);

	const acceptedCount = selectedFiles.length;

	const errors = useMemo(() => {
		const nextErrors = [];

		if (acceptedCount > MAX_ACCEPTED_FILES) {
			nextErrors.push({
				fileName: "Accepted files",
				message: `❌ Too many accepted files. Please keep between 1 and ${MAX_ACCEPTED_FILES} accepted files on this page before uploading.`,
				itemId: ACCEPTED_LIMIT_ERROR_ID,
			});
		}

		fileItems.forEach((item) => {
			if (item.status !== "rejected") return;
			item.errors.forEach((message) => {
				nextErrors.push({ fileName: item.file.name, message, itemId: item.id });
			});
		});

		return nextErrors;
	}, [acceptedCount, fileItems]);

	const warnings = fileItems.flatMap((item) =>
		item.warnings.map((message) => ({ id: `${item.id}-${message}`, message }))
	);

	return (
		<section className="rounded-xl border border-lavander bg-white p-6 shadow-sm md:p-8">
			<div className="mb-6">
				<h2 className="font-serif text-2xl tracking-tight text-deep-violet-blue">Sales Data Upload</h2>
				<p className="mt-2 text-sm text-deep-violet-blue/80">
					Keep 1 to 10 accepted files on this page before uploading. You can browse more than once. Rejected files do not count toward the limit. Supported formats: .xlsx, .csv, .txt.
				</p>
			</div>

			<div
				role="button"
				tabIndex={0}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				onClick={handleBrowseClick}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						handleBrowseClick();
					}
				}}
				aria-label="Drag and drop sales files here or browse files"
				className={`group rounded-xl border-2 border-dashed p-8 text-center transition ${
					isDragging
						? "border-deep-violet-blue bg-lavander shadow-md"
						: "border-violet bg-cream hover:border-deep-violet-blue hover:bg-lavander"
				} ${isProcessing ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
			>
				<p className="text-lg font-medium text-deep-violet-blue">
					Drag and drop files here
				</p>
				<p className="mt-2 text-sm text-deep-violet-blue/80">or click to browse your device</p>

				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						handleBrowseClick();
					}}
					disabled={isProcessing}
					className="mt-5 rounded-lg border border-deep-violet-blue bg-deep-violet-blue px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-60"
					aria-label="Browse files"
				>
					Browse Files
				</button>

				<input
					ref={inputRef}
					type="file"
					multiple
					accept=".xlsx,.csv,.txt"
					className="hidden"
					onChange={handleInputChange}
					disabled={isProcessing}
					aria-label="Select sales data files"
				/>
			</div>

			{!!errors.length && (
				<div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
					<h3 className="mb-2 text-sm font-semibold text-red-700">Issues to Fix</h3>
					<ul className="space-y-1 text-sm text-red-700">
						{errors.map((error, index) => (
							<li key={`${error.itemId || error.fileName}-${index}`}>{error.message}</li>
						))}
					</ul>
				</div>
			)}

			{!!warnings.length && (
				<div className="mt-4 rounded-lg border border-violet bg-lavander p-4">
					<h3 className="mb-2 text-sm font-semibold text-deep-violet-blue">Warnings</h3>
					<ul className="space-y-1 text-sm text-deep-violet-blue">
						{warnings.map((warning) => (
							<li key={warning.id}>{warning.message}</li>
						))}
					</ul>
				</div>
			)}

			<div className="mt-6 rounded-xl border border-lavander bg-cream p-4 shadow-sm">
				<div className="mb-3 flex items-center justify-between gap-3">
					<h3 className="text-sm font-semibold text-deep-violet-blue">Selected Files</h3>
					<div className="flex items-center gap-3">
						<span className="text-xs text-deep-violet-blue/80">{acceptedCount} accepted</span>
						<button
							type="button"
							onClick={removeAllFiles}
							disabled={!fileItems.length || isProcessing}
							className="rounded-md border border-violet px-3 py-1.5 text-xs font-medium text-deep-violet-blue transition hover:bg-lavander focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-60"
							aria-label="Remove all selected files"
						>
							Remove all
						</button>
					</div>
				</div>

				{!fileItems.length && (
					<p className="text-sm text-deep-violet-blue/80">No files selected yet.</p>
				)}

				{!!fileItems.length && (
					<ul className="space-y-3">
						{fileItems.map((item) => (
							<li
								key={item.id}
								className="rounded-lg border border-lavander bg-white p-3 shadow-sm"
							>
								<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
									<button
										type="button"
										onClick={() => openPreview(item)}
										className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
										aria-label={`Preview ${item.file.name}`}
									>
										<span className="text-lg" aria-hidden="true">
											{getFileTypeIcon(item.file)}
										</span>
										<div className="min-w-0">
											<p className="truncate text-sm font-medium text-deep-violet-blue">{item.file.name}</p>
											<p className="text-xs text-deep-violet-blue/80">
												{formatFileSize(item.file.size)} • .{getFileExtension(item.file.name)}
											</p>
										</div>
									</button>

									<div className="flex items-center gap-3">
										<span
											className={`rounded-md px-2 py-1 text-xs font-medium ${
												item.status === "accepted"
													? "bg-green-100 text-green-700"
													: "bg-red-100 text-red-700"
											}`}
											aria-label={item.status === "accepted" ? "Accepted file" : "Rejected file"}
										>
											{item.status === "accepted" ? "✓ Accepted" : "✗ Rejected"}
										</span>

										<button
											type="button"
											onClick={() => removeFile(item.id)}
											className="rounded-md border border-violet px-3 py-1.5 text-xs font-medium text-deep-violet-blue transition hover:bg-lavander focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
											aria-label={`Remove ${item.file.name}`}
										>
											Remove
										</button>
									</div>
								</div>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="mt-6 flex justify-end">
				<button
					type="button"
					onClick={handleUpload}
					disabled={isProcessing || acceptedCount === 0 || acceptedCount > MAX_ACCEPTED_FILES}
					className="rounded-lg border border-deep-violet-blue bg-deep-violet-blue px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-60"
					aria-label="Upload validated files"
				>
					{isProcessing ? "Uploading..." : `Upload ${selectedFiles.length} Valid File${selectedFiles.length === 1 ? "" : "s"}`}
				</button>
			</div>

			<PreviewModal
				previewState={{
					file: previewFile?.file || null,
					status: previewFile?.status || "rejected",
					warnings: previewFile?.warnings || [],
					errors: previewFile?.errors || [],
					data: previewData,
					loading: previewLoading,
					loadError: previewError,
				}}
				onClose={closePreview}
			/>
		</section>
	);
}
