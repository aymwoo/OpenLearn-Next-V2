// strict: semver 无随包类型（且不新增 @types/semver 依赖），此处提供最小 ambient 声明。
// 覆盖仓内全部 7 处 import 涉及的 API：satisfies/gt/lt/valid/parse/coerce + SemVer 类型。
// 与 @types/semver 同构（namespace + export =），故 `import semver from 'semver'`
// 的值用法（semver.gt）与类型用法（semver.SemVer）均成立；零运行时影响。
declare module 'semver' {
  namespace semver {
    interface SemVer {
      major: number;
      minor: number;
      patch: number;
      prerelease: ReadonlyArray<string | number>;
      build: ReadonlyArray<string>;
      version: string;
      raw: string;
    }
    function parse(version: string | null | undefined): SemVer | null;
    function valid(version: string | null | undefined): string | null;
    function satisfies(version: string | SemVer, range: string): boolean;
    function gt(a: string | SemVer, b: string | SemVer): boolean;
    function lt(a: string | SemVer, b: string | SemVer): boolean;
    function coerce(version: string | number | null | undefined): SemVer | null;
  }
  export = semver;
}
