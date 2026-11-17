/** R-36d 基础扩展 · 程序设计（C）（concept-only：只讲不挂求解模板）。 */
import type { KnowledgeEntry } from '../types.ts';

export const PROGRAMMING: KnowledgeEntry[] = [
  {
    id: 'programming.c-pointer-array',
    subject: 'programming',
    chapter: 'C 语言基础',
    title: '指针与数组的关系',
    aliases: ['指针', '数组名', '指针运算'],
    oneLine: '数组名是首元素地址，p+i 走 i 个元素；下标法是指针法的语法糖。',
    approach: [
      '记住恒等式 a[i] 等价于 *(a+i)，数组名在表达式里退化为指针。',
      '指针加减按指向类型的大小走步，int* 加 1 走 4 字节。',
      '传数组给函数即传指针，函数内 sizeof 拿到的是指针大小不是数组。',
      '字符串以 \\0 结尾，遍历用 *p++ 直到遇零。',
    ],
    formulas: [
      { tex: 'a[i] \\;\\equiv\\; *(a + i)', note: '下标与指针等价' },
      { tex: '\\text{sizeof(arr)} \\ne \\text{sizeof(ptr)}', note: '数组与指针的差别' },
    ],
    points: [
      '数组名只在 sizeof 与 &a 两处保持数组语义，其余场合都是地址。',
      '指针必须指向有效内存才能解引用，野指针与空指针都要防。',
      '二维数组按行主序连续存放，a[i][j] 即 *(*(a+i)+j)。',
    ],
    pitfalls: [
      '对未初始化的指针直接解引用，程序当场崩溃还位置随机。',
    ],
    related: ['programming.c-memory-model'],
  },
  {
    id: 'programming.c-struct-union',
    subject: 'programming',
    chapter: 'C 语言基础',
    title: '结构体、联合体与内存对齐',
    aliases: ['结构体', '内存对齐', '联合体'],
    oneLine: '结构体按成员最大对齐数补齐，顺序不同 sizeof 可能不同。',
    approach: [
      '结构体是聚合类型，成员按声明顺序存放，各成员要对齐到自身大小。',
      '整体大小向上取整到最大对齐数的整数倍。',
      '把小成员排一起、大成员排后面，能显著省内存。',
      '联合体成员共用同一段内存，sizeof 取最大成员，改一个会冲掉其他。',
    ],
    formulas: [
      { tex: '\\text{sizeof} = k \\cdot \\max(\\text{align}),\\; k \\in \\mathbb{Z}^+', note: '整体补齐规则' },
    ],
    points: [
      '对齐规则：成员偏移量必须是对齐数的整数倍，编译器自动填 padding。',
      '位域可按比特切分成员，跨平台行为不保证一致。',
      '结构体传参建议传指针，值传递会整块拷贝。',
    ],
    related: ['programming.c-memory-model'],
  },
  {
    id: 'programming.c-function-recursion',
    subject: 'programming',
    chapter: 'C 语言基础',
    title: '函数调用、栈帧与递归',
    aliases: ['递归', '栈帧', '函数调用'],
    oneLine: '每次调用压一个栈帧：参数、返回地址、局部变量；递归深度有上限。',
    approach: [
      '递归两要素：基准情形（直接返回）+ 递归式（规模缩小）。',
      '画调用树验证：参数单调趋于基准情形，树不会无限生长。',
      '栈帧随调用压栈、随返回弹出，深度过大即栈溢出。',
      '重叠子问题多的递归改记忆化或直接转迭代。',
    ],
    formulas: [
      { tex: 'T(n) = T(n-1) + O(1) \\Rightarrow O(n)', note: '线性递归的时间' },
      { tex: 'T(n) = 2T(n-1) + O(1) \\Rightarrow O(2^n)', note: '斐波那契朴素递归' },
    ],
    points: [
      '没有基准情形的递归必然栈溢出，先写出口再写递归。',
      '值传递拷贝实参，想改调用方变量要传指针。',
      '尾递归可被优化成循环，但 C 标准并不保证。',
    ],
    related: ['programming.c-memory-model', 'programming.c-pointer-array'],
  },
  {
    id: 'programming.c-memory-model',
    subject: 'programming',
    chapter: 'C 语言进阶',
    title: '内存四区与常见内存错误',
    aliases: ['内存四区', '野指针', '内存泄漏', 'malloc'],
    oneLine: '栈自动管、堆手动管：malloc 配对 free，悬空指针用前必须置空。',
    approach: [
      '分区记账：代码区、静态/全局区、栈（自动）、堆（手动）。',
      'malloc/calloc/realloc 申请的每一块都要有恰好一次 free。',
      'free 之后立即置 NULL，防止悬空指针二次使用。',
      '返回栈变量地址是大忌；要带出数据用堆或调用方缓冲区。',
    ],
    formulas: [
      { tex: '\\text{泄漏} = \\text{malloc} - \\text{free} > 0', note: '泄漏的记账口径' },
    ],
    points: [
      '栈上大数组开几百 KB 就可能爆栈，大块数据放堆或静态区。',
      '内存错误（越界写、悬空指针）症状滞后且随机，工具查比猜快。',
      'realloc 返回新指针，直接赋回原变量失败时会丢原块。',
    ],
    pitfalls: [
      'free 之后再读再写再 free，都是未定义行为，问题会在别处爆发。',
    ],
    related: ['programming.c-pointer-array'],
  },
];
