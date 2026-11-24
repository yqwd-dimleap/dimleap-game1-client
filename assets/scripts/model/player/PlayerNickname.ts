/** Chinese/full-width characters count as two, ASCII as one; mixed names share a 12-unit budget. */
export function parsePlayerNickname(input: string): { nickname: string; error?: string } {
    const nickname = input.trim();
    if (!nickname) return { nickname, error: '请输入昵称' };
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(input)) return { nickname, error: '昵称不能包含换行或控制字符' };
    const length = Array.from(nickname).reduce((sum, char) => sum + (char.codePointAt(0)! <= 0x7f ? 1 : 2), 0);
    return length > 12 ? { nickname, error: '昵称最多6个中文或12个英文字母' } : { nickname };
}
