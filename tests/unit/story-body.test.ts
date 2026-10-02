import { describe,expect,it } from 'vitest';
import { storyBodyIssues } from '../../src/domain/story-body';

describe('正文问题定位',()=>{
  it('reports the actual mental and involuntary-action sentences with textarea offsets',()=>{
    const body='灯火轻摇。\n\n她脑子里先跳出来的是那个数字——17%。\n\n她直起身，下意识把折子挪了半寸。\n\n沈彻拱手道：“有军报。”';
    const issues=storyBodyIssues('让对方进来',body);
    expect(issues.map(i=>i.quote)).toEqual(['她脑子里先跳出来的是那个数字——17%。','她直起身，下意识把折子挪了半寸。']);
    for(const issue of issues)expect(body.slice(issue.start,issue.end)).toBe(issue.quote);
  });
  it('deduplicates overlapping checks and does not flag ordinary NPC actions',()=>{
    expect(storyBodyIssues('稍等','她心中下意识做出了决定。')).toHaveLength(1);
    expect(storyBodyIssues('让沈彻进来','沈彻走进门来，在她案前三步处停住。沈彻心想，这件事得慢慢说。')).toEqual([]);
  });
  it('offers investigation wording as a non-binding hint',()=>{
    expect(storyBodyIssues('你好','调查已经完成。')).toHaveLength(1);
    expect(storyBodyIssues('请调查此事','调查已经完成。')).toEqual([]);
  });
  it('bounds repeated diagnostics in long model output',()=>{
    expect(storyBodyIssues('稍等','她心想'.repeat(20000))).toHaveLength(1);
    expect(storyBodyIssues('稍等','她心想此事有异。'.repeat(10000)).length).toBeLessThanOrEqual(24);
  });
});
