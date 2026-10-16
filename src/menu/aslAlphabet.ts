export interface ASLLetterReference {
  letter: string;
  motion: boolean;
  description: string;
}

const descriptions = [
  'Close the fingers into a fist. Keep the thumb alongside the index finger, not across the fingers.',
  'Hold four fingers straight and together, pointing up. Fold the thumb across the palm.',
  'Curve the fingers and thumb toward each other to form an open C.',
  'Point the index finger up. Touch the thumb to the curved middle, ring, and little fingers.',
  'Bend all four fingers down toward the thumb. Keep the fingertips close to the thumb.',
  'Touch the index fingertip to the thumb tip to form a circle. Extend the other three fingers.',
  'Point the index finger and thumb sideways, roughly parallel. Fold the other three fingers.',
  'Extend the index and middle fingers together, pointing sideways. Fold the other fingers.',
  'Extend the little finger upward. Fold the other fingers into a fist with the thumb across them.',
  'Start with the I handshape. Use the little fingertip to trace a J, including its curved bottom.',
  'Extend the index and middle fingers in a V. Place the thumb between them against the middle finger.',
  'Extend the index finger upward and the thumb sideways to make an L. Fold the other fingers.',
  'Close the fingers over the thumb so the thumb is tucked beneath the index, middle, and ring fingers.',
  'Close the fingers over the thumb so the thumb is tucked beneath the index and middle fingers.',
  'Curve all fingers toward the thumb so the fingertips meet it, forming an O.',
  'Make the K handshape, then tip it downward so the middle finger points toward the ground.',
  'Make the G handshape, then point the index finger and thumb downward.',
  'Extend the index and middle fingers upward and cross the middle over the index. Fold the other fingers.',
  'Make a closed fist with the thumb resting across the front of the folded fingers.',
  'Make a fist with the thumb tucked between the index and middle fingers.',
  'Extend the index and middle fingers upward, straight and together. Fold the other fingers.',
  'Extend the index and middle fingers upward and spread them into a V. Fold the other fingers.',
  'Extend the index, middle, and ring fingers upward and spread them. Hold the little finger down with the thumb.',
  'Fold the fingers into a fist, then raise the index finger with its joints bent into a hook.',
  'Extend the thumb and little finger out to the sides. Fold the three middle fingers.',
  'Point the index finger outward. Trace a Z: across, diagonally back, then across again.',
];

export const ASL_ALPHABET: readonly ASLLetterReference[] = descriptions.map((description, index) => {
  const letter = String.fromCharCode(65 + index);
  return { letter, motion: letter === 'J' || letter === 'Z', description };
});

export const ASL_NUMBERS: readonly ASLLetterReference[] = [
  'Curve the fingers to meet the thumb, forming a closed oval for zero. This shares the O handshape.',
  'Extend only the index finger. For an isolated number, keep the palm toward yourself.',
  'Extend the index and middle fingers. For an isolated number, keep the palm toward yourself.',
  'Extend the thumb, index, and middle fingers. Fold the ring and little fingers; palm toward yourself.',
  'Extend four fingers with the thumb folded across the palm; palm toward yourself.',
  'Spread all five fingers with the palm toward yourself for an isolated five.',
  'Touch the thumb tip to the little fingertip. Extend the other three fingers; palm outward.',
  'Touch the thumb tip to the ring fingertip. Extend the other three fingers; palm outward.',
  'Touch the thumb tip to the middle fingertip. Extend the other three fingers; palm outward.',
  'Touch the thumb tip to the index fingertip. Extend the other three fingers; palm outward. This shares the F handshape.',
].map((description, index) => ({ letter: String(index), motion: false, description }));

export const ASL_SYMBOLS: readonly ASLLetterReference[] = [...ASL_ALPHABET, ...ASL_NUMBERS];

export function getASLLetterReference(letter: string): ASLLetterReference | undefined {
  return ASL_SYMBOLS.find(reference => reference.letter === letter.trim().toUpperCase());
}

export function getASLLetterImage(letter: string): string | undefined {
  const reference = getASLLetterReference(letter);
  return reference ? `${import.meta.env.BASE_URL}asl/${reference.letter}.${/^[1-9]$/.test(reference.letter) ? 'jpg' : 'svg'}` : undefined;
}
