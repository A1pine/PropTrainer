// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import CelebrationBurst from '@/components/ui/CelebrationBurst.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CelebrationBurst', () => {
  it('renders nothing while inactive', () => {
    const wrapper = mount(CelebrationBurst, { props: { active: false } })
    expect(document.querySelector('.celebration')).toBeNull()
    wrapper.unmount()
  })

  it('renders the requested number of particles', () => {
    const wrapper = mount(CelebrationBurst, { props: { active: true, count: 6 }, attachTo: document.body })
    expect(document.querySelectorAll('.celebration-piece')).toHaveLength(6)
    wrapper.unmount()
  })
})
