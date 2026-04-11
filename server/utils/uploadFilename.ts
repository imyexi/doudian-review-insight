import iconv from "iconv-lite";

const CJK_FILENAME_PATTERN = /[\u4E00-\u9FFF]/;
const LATIN1_MOJIBAKE_PATTERN = /[\u00C0-\u00FF]/;
const PRIVATE_USE_CHARACTER_PATTERN = /[\uE000-\uF8FF]/;

interface FilenameCandidate {
  value: string;
  cjkCount: number;
  hasLatin1Mojibake: boolean;
  hasPrivateUseCharacter: boolean;
  hasReplacementCharacter: boolean;
}

function countCjkCharacters(value: string): number {
  return Array.from(value).filter(character => CJK_FILENAME_PATTERN.test(character)).length;
}

function createCandidate(value: string): FilenameCandidate {
  return {
    value,
    cjkCount: countCjkCharacters(value),
    hasLatin1Mojibake: LATIN1_MOJIBAKE_PATTERN.test(value),
    hasPrivateUseCharacter: PRIVATE_USE_CHARACTER_PATTERN.test(value),
    hasReplacementCharacter: value.includes("\uFFFD"),
  };
}

function scoreCandidate(candidate: FilenameCandidate): number {
  if (candidate.hasReplacementCharacter) {
    return Number.NEGATIVE_INFINITY;
  }

  return (candidate.cjkCount * 10)
    - (candidate.hasLatin1Mojibake ? 25 : 0)
    - (candidate.hasPrivateUseCharacter ? 25 : 0);
}

export function normalizeUploadedFilename(originalFilename: string): string {
  const originalCandidate = createCandidate(originalFilename);
  if (!originalCandidate.hasLatin1Mojibake && !originalCandidate.hasPrivateUseCharacter) {
    return originalFilename;
  }

  const latin1Bytes = Buffer.from(originalFilename, "latin1");
  const utf8FromLatin1 = new TextDecoder("utf-8").decode(latin1Bytes);
  const gb18030FromLatin1 = new TextDecoder("gb18030").decode(latin1Bytes);
  const utf8FromGb18030 = iconv.decode(iconv.encode(originalFilename, "gb18030"), "utf-8");

  const candidates = [
    originalCandidate,
    createCandidate(utf8FromLatin1),
    createCandidate(gb18030FromLatin1),
    createCandidate(utf8FromGb18030),
  ];

  return candidates
    .sort((left, right) => scoreCandidate(right) - scoreCandidate(left))[0]?.value ?? originalFilename;
}

export function serializeUpload<T extends { originalFilename: string }>(upload: T): T {
  return {
    ...upload,
    originalFilename: normalizeUploadedFilename(upload.originalFilename),
  };
}
